const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class ProcessManager {
    constructor(configFile) {
        this.configFile = configFile;
        this.instanceName = path.basename(configFile, '.json');
        this.process = null;
        this.restartCount = 0;
        this.maxRestarts = 10; // Global limit
        this.isShuttingDown = false;
        this.startTime = null;
        this.logFile = path.join(__dirname, 'logs', `${this.instanceName}_manager.log`);
        this.lastOutput = ''; // Store last output for error analysis
        
        // Errors that should NOT trigger restart
        this.nonRestartableErrors = [
            'invalid token',
            'unauthorized', 
            'token was revoked',
            'missing permissions',
            'invalid client secret',
            'token has expired',
            'failed to start bot: connect econnrefused' // Database connection issues
        ];
        
        // Ensure logs directory exists
        const logsDir = path.dirname(this.logFile);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        
        this.log(`[ProcessManager] Initialized for instance: ${this.instanceName}`);
        this.log(`[ProcessManager] Auto-restart enabled with smart error detection`);
    }

    /**
     * Log message with timestamp
     * @param {string} message - Message to log
     */
    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} ${message}\n`;
        
        console.log(message);
        
        try {
            fs.appendFileSync(this.logFile, logEntry);
        } catch (error) {
            console.error('Failed to write to log file:', error.message);
        }
    }

    /**
     * Start the Discord bot instance
     * @returns {Promise<void>}
     */
    async start() {
        if (this.process) {
            this.log(`[ProcessManager] Instance already running (PID: ${this.process.pid})`);
            return;
        }

        this.startTime = Date.now();
        this.log(`[ProcessManager] Starting instance (attempt ${this.restartCount + 1})`);

        return new Promise((resolve, reject) => {
            const args = [path.join(__dirname, 'app.js'), this.configFile];
            
            this.process = spawn('node', args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: false,
                cwd: __dirname
            });

            // Setup process event handlers
            this.setupProcessHandlers(resolve, reject);
        });
    }

    /**
     * Setup event handlers for the spawned process
     * @param {Function} resolve - Promise resolve function
     * @param {Function} reject - Promise reject function
     */
    setupProcessHandlers(resolve, reject) {
        let hasResolved = false;

        // Handle process output
        this.process.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output) {
                this.lastOutput = output; // Store for error analysis
                this.log(`[STDOUT] ${output}`);
                
                // Check for successful startup
                if (output.includes('Bot logged in successfully') && !hasResolved) {
                    hasResolved = true;
                    resolve();
                }
            }
        });

        this.process.stderr.on('data', (data) => {
            const error = data.toString().trim();
            if (error) {
                this.lastOutput = error; // Store for error analysis
                this.log(`[STDERR] ${error}`);
            }
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
            const runtime = this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0;
            this.log(`[ProcessManager] Process exited (code: ${code}, signal: ${signal}, runtime: ${runtime}s)`);
            
            this.process = null;
            this.startTime = null;

            if (!hasResolved) {
                hasResolved = true;
                reject(new Error(`Process exited during startup (code: ${code})`));
                return;
            }

            // Handle restart logic
            this.handleProcessExit(code, signal, runtime);
        });

        this.process.on('error', (error) => {
            this.log(`[ProcessManager] Process error: ${error.message}`);
            
            if (!hasResolved) {
                hasResolved = true;
                reject(error);
            }
        });

        // Timeout for startup
        setTimeout(() => {
            if (!hasResolved) {
                hasResolved = true;
                this.log(`[ProcessManager] Startup timeout reached`);
                this.stop();
                reject(new Error('Startup timeout'));
            }
        }, 60000); // 60 second timeout
    }

    /**
     * Handle process exit and determine if restart is needed
     * @param {number} code - Exit code
     * @param {string} signal - Exit signal
     * @param {number} runtime - Runtime in seconds
     */
    async handleProcessExit(code, signal, runtime) {
        if (this.isShuttingDown) {
            this.log(`[ProcessManager] Shutdown in progress, not restarting`);
            return;
        }

        // Check exit conditions
        if (signal === 'SIGINT' || signal === 'SIGTERM') {
            this.log(`[ProcessManager] Graceful shutdown detected (${signal}), not restarting`);
            return;
        }

        if (code === 0) {
            this.log(`[ProcessManager] Clean exit detected, not restarting`);
            return;
        }

        if (code === 2) {
            this.log(`[ProcessManager] Restart requested by application`);
        } else {
            this.log(`[ProcessManager] Unexpected exit detected (code: ${code})`);
        }

        // Check for non-restartable errors
        if (this.isNonRestartableError()) {
            this.log(`[ProcessManager] Non-restartable error detected in output. Stopping auto-restart.`);
            this.log(`[ProcessManager] Last output: ${this.lastOutput}`);
            this.log(`[ProcessManager] Please fix the issue and restart manually.`);
            return;
        }

        // Check restart limits
        if (this.restartCount >= this.maxRestarts) {
            this.log(`[ProcessManager] Maximum restart limit (${this.maxRestarts}) reached, giving up`);
            return;
        }

        // Check if process crashed too quickly (< 30 seconds)
        if (runtime < 30) {
            this.log(`[ProcessManager] Process crashed too quickly (${runtime}s), waiting before restart...`);
            await this.delay(10000); // Wait 10 seconds for quick crashes
        } else {
            await this.delay(5000); // Wait 5 seconds for normal restarts
        }

        // Attempt restart
        this.restartCount++;
        this.log(`[ProcessManager] Attempting restart ${this.restartCount}/${this.maxRestarts}`);

        try {
            await this.start();
        } catch (error) {
            this.log(`[ProcessManager] Restart failed: ${error.message}`);
            
            if (this.restartCount < this.maxRestarts) {
                this.log(`[ProcessManager] Will retry restart in 30 seconds...`);
                setTimeout(() => this.handleProcessExit(1, null, 0), 30000);
            }
        }
    }

    /**
     * Stop the Discord bot instance
     * @param {string} signal - Signal to send (default: SIGTERM)
     */
    stop(signal = 'SIGTERM') {
        if (!this.process) {
            this.log(`[ProcessManager] No process to stop`);
            return;
        }

        this.isShuttingDown = true;
        this.log(`[ProcessManager] Stopping process (PID: ${this.process.pid}) with ${signal}`);

        try {
            this.process.kill(signal);
            
            // Force kill after 10 seconds if not stopped
            setTimeout(() => {
                if (this.process) {
                    this.log(`[ProcessManager] Force killing process`);
                    this.process.kill('SIGKILL');
                }
            }, 10000);
            
        } catch (error) {
            this.log(`[ProcessManager] Error stopping process: ${error.message}`);
        }
    }

    /**
     * Get process status
     * @returns {Object} - Status information
     */
    getStatus() {
        return {
            running: !!this.process,
            pid: this.process?.pid || null,
            restartCount: this.restartCount,
            maxRestarts: this.maxRestarts,
            uptime: this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0,
            instanceName: this.instanceName
        };
    }

    /**
     * Reset restart counter
     */
    resetRestartCount() {
        this.restartCount = 0;
        this.log(`[ProcessManager] Restart counter reset`);
    }

    /**
     * Delay utility
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if the last error should prevent restart
     * @returns {boolean} - True if error is non-restartable
     */
    isNonRestartableError() {
        const errorText = this.lastOutput.toLowerCase();
        
        return this.nonRestartableErrors.some(pattern => 
            errorText.includes(pattern.toLowerCase())
        );
    }
}

// If called directly, start the specified instance
if (require.main === module) {
    const configFile = process.argv[2];
    
    if (!configFile) {
        console.error('Usage: node process-manager.js <config-file>');
        process.exit(1);
    }

    if (!fs.existsSync(configFile)) {
        console.error(`Config file not found: ${configFile}`);
        process.exit(1);
    }

    const manager = new ProcessManager(configFile);
    
    // Handle manager shutdown
    process.on('SIGINT', () => {
        console.log('Received SIGINT, stopping managed process...');
        manager.stop('SIGINT');
        setTimeout(() => process.exit(0), 5000);
    });

    process.on('SIGTERM', () => {
        console.log('Received SIGTERM, stopping managed process...');
        manager.stop('SIGTERM');
        setTimeout(() => process.exit(0), 5000);
    });

    // Start the instance
    manager.start().then(() => {
        console.log(`Instance ${manager.instanceName} started successfully`);
    }).catch((error) => {
        console.error(`Failed to start instance: ${error.message}`);
        process.exit(1);
    });
}

module.exports = ProcessManager;
