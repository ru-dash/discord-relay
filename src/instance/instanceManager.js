const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const StatusTracker = require('./statusTracker');

class InstanceManager {
    constructor() {
        this.instances = new Map();
        this.configsDir = path.join(__dirname, '../../configs');
        this.logsDir = path.join(__dirname, '../../logs');
        this.statusTracker = new StatusTracker();
        this.ensureDirectories();
        this.cleanupOnStart();
    }

    /**
     * Ensure required directories exist
     */
    ensureDirectories() {
        if (!fs.existsSync(this.configsDir)) {
            fs.mkdirSync(this.configsDir, { recursive: true });
        }
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    /**
     * Create a new instance configuration
     * @param {string} instanceName - Name of the instance
     * @param {Object} config - Configuration object
     */
    createInstanceConfig(instanceName, config) {
        const configPath = path.join(this.configsDir, `${instanceName}.json`);
        
        const instanceConfig = {
            agentName: config.agentName || instanceName,
            token: config.token,
            systemHook: config.systemHook,
            eventHook: config.eventHook,
            channelMappings: config.channelMappings || [],
            instanceName: instanceName,
            dbPath: path.join(__dirname, `../../databases/${instanceName}.db`)
        };

        // Ensure database directory exists
        const dbDir = path.dirname(instanceConfig.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        fs.writeFileSync(configPath, JSON.stringify(instanceConfig, null, 2));
        console.log(`Created configuration for instance: ${instanceName}`);
        return configPath;
    }

    /**
     * List all available instance configurations
     * @returns {Array<string>} - Array of instance names
     */
    listInstances() {
        if (!fs.existsSync(this.configsDir)) {
            return [];
        }

        return fs.readdirSync(this.configsDir)
            .filter(file => file.endsWith('.json'))
            .map(file => path.basename(file, '.json'));
    }

    /**
     * Start a specific instance
     * @param {string} instanceName - Name of the instance to start
     * @returns {Object} - Child process object
     */
    startInstance(instanceName) {
        const configPath = path.join(this.configsDir, `${instanceName}.json`);
        
        if (!fs.existsSync(configPath)) {
            throw new Error(`Configuration not found for instance: ${instanceName}`);
        }

        // Check if instance is already running
        const existingStatus = this.statusTracker.getInstanceStatus(instanceName);
        if (existingStatus && existingStatus.pid && this.statusTracker.isProcessRunning(existingStatus.pid)) {
            console.log(`Instance ${instanceName} is already running (PID: ${existingStatus.pid})`);
            return null;
        }

        console.log(`Starting instance: ${instanceName}`);
        
        const logFile = path.join(this.logsDir, `${instanceName}.log`);
        const errorLogFile = path.join(this.logsDir, `${instanceName}_error.log`);
        
        // Open log files for writing
        const logFd = fs.openSync(logFile, 'a');
        const errorLogFd = fs.openSync(errorLogFile, 'a');

        // Use detached mode with proper stdio configuration
        const child = spawn('node', ['app.js', configPath], {
            cwd: path.join(__dirname, '../..'),
            detached: true,
            stdio: ['ignore', logFd, errorLogFd]
        });

        // Close file descriptors in parent process
        fs.closeSync(logFd);
        fs.closeSync(errorLogFd);

        // Allow the parent process to exit independently
        child.unref();

        // Update status tracker
        this.statusTracker.updateInstanceStatus(instanceName, {
            pid: child.pid,
            status: 'starting',
            configPath: configPath,
            logFile: logFile,
            errorLogFile: errorLogFile,
            startTime: new Date().toISOString()
        });

        // Set up event handlers with setTimeout to avoid blocking
        setTimeout(() => {
            if (this.statusTracker.isProcessRunning(child.pid)) {
                console.log(`Instance ${instanceName} started successfully (PID: ${child.pid})`);
                this.statusTracker.updateInstanceStatus(instanceName, {
                    pid: child.pid,
                    status: 'running',
                    configPath: configPath,
                    logFile: logFile,
                    errorLogFile: errorLogFile,
                    startTime: new Date().toISOString()
                });
            }
        }, 1000);

        child.on('close', (code) => {
            this.statusTracker.removeInstance(instanceName);
            this.instances.delete(instanceName);
        });

        child.on('error', (error) => {
            console.error(`Failed to start instance ${instanceName}: ${error.message}`);
            this.statusTracker.removeInstance(instanceName);
        });

        this.instances.set(instanceName, {
            process: child,
            configPath: configPath,
            logFile: logFile,
            errorLogFile: errorLogFile,
            startTime: new Date()
        });

        return child;
    }

    /**
     * Stop a specific instance
     * @param {string} instanceName - Name of the instance to stop
     */
    stopInstance(instanceName) {
        const instanceStatus = this.statusTracker.getInstanceStatus(instanceName);
        
        if (!instanceStatus || !instanceStatus.pid) {
            console.log(`Instance ${instanceName} is not running`);
            return;
        }

        if (!this.statusTracker.isProcessRunning(instanceStatus.pid)) {
            console.log(`Instance ${instanceName} process is already dead, cleaning up`);
            this.statusTracker.removeInstance(instanceName);
            return;
        }

        console.log(`Stopping instance: ${instanceName} (PID: ${instanceStatus.pid})`);
        
        try {
            // Try graceful shutdown first
            process.kill(instanceStatus.pid, 'SIGTERM');
            
            // Update status to stopping
            this.statusTracker.updateInstanceStatus(instanceName, {
                ...instanceStatus,
                status: 'stopping'
            });
            
            // Force kill after 10 seconds if it doesn't shut down gracefully
            setTimeout(() => {
                if (this.statusTracker.isProcessRunning(instanceStatus.pid)) {
                    console.log(`Force killing instance: ${instanceName}`);
                    try {
                        process.kill(instanceStatus.pid, 'SIGKILL');
                    } catch (error) {
                        console.error(`Error force killing instance ${instanceName}:`, error.message);
                    }
                }
                this.statusTracker.removeInstance(instanceName);
            }, 10000);
            
        } catch (error) {
            console.error(`Error stopping instance ${instanceName}:`, error.message);
            // Clean up status even if kill failed
            this.statusTracker.removeInstance(instanceName);
        }
    }

    /**
     * Start all configured instances
     */
    startAllInstances() {
        const instances = this.listInstances();
        console.log(`Starting ${instances.length} instances...`);
        
        instances.forEach(instanceName => {
            try {
                this.startInstance(instanceName);
            } catch (error) {
                console.error(`Failed to start instance ${instanceName}: ${error.message}`);
            }
        });
    }

    /**
     * Stop all running instances
     */
    stopAllInstances() {
        console.log('Stopping all instances...');
        const allStatus = this.statusTracker.getAllStatus();
        
        for (const instanceName of Object.keys(allStatus)) {
            this.stopInstance(instanceName);
        }
    }

    /**
     * Get status of all instances
     * @returns {Array<Object>} - Array of instance status objects
     */
    getInstancesStatus() {
        const allInstances = this.listInstances();
        const statusData = this.statusTracker.getAllStatus();
        
        // Clean up stale instances first
        this.statusTracker.cleanupStaleInstances();
        const cleanStatusData = this.statusTracker.getAllStatus();
        
        return allInstances.map(instanceName => {
            const instanceStatus = cleanStatusData[instanceName];
            const isRunning = instanceStatus && instanceStatus.pid && 
                             this.statusTracker.isProcessRunning(instanceStatus.pid);
            
            return {
                name: instanceName,
                running: isRunning,
                status: instanceStatus ? instanceStatus.status : 'stopped',
                pid: instanceStatus ? instanceStatus.pid : null,
                startTime: instanceStatus ? new Date(instanceStatus.startTime) : null,
                configPath: path.join(this.configsDir, `${instanceName}.json`),
                logFile: path.join(this.logsDir, `${instanceName}.log`),
                errorLogFile: path.join(this.logsDir, `${instanceName}_error.log`)
            };
        });
    }

    /**
     * Generate a template configuration file
     * @param {string} instanceName - Name of the instance
     */
    generateTemplate(instanceName) {
        const templateConfig = {
            agentName: instanceName,
            token: "YOUR_DISCORD_TOKEN_HERE",
            systemHook: "YOUR_SYSTEM_WEBHOOK_URL_HERE",
            eventHook: "YOUR_EVENT_WEBHOOK_URL_HERE",
            channelMappings: [
                {
                    channelId: "CHANNEL_ID_HERE",
                    webhookUrl: "WEBHOOK_URL_HERE"
                }
            ]
        };

        return this.createInstanceConfig(instanceName, templateConfig);
    }

    /**
     * Cleanup stale instances on start
     */
    cleanupOnStart() {
        this.statusTracker.cleanupStaleInstances();
    }
}

module.exports = InstanceManager;
