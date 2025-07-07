const ProcessManager = require('./process-manager');
const fs = require('fs');
const path = require('path');

class InstanceMonitor {
    constructor() {
        this.instances = new Map();
    }

    /**
     * Start monitoring an instance
     * @param {string} configFile - Path to config file
     */
    async startInstance(configFile) {
        const instanceName = path.basename(configFile, '.json');
        
        if (this.instances.has(instanceName)) {
            console.log(`Instance ${instanceName} is already being monitored`);
            return;
        }

        console.log(`Starting instance: ${instanceName}`);
        
        const manager = new ProcessManager(configFile);
        this.instances.set(instanceName, manager);

        try {
            await manager.start();
            console.log(`✅ Instance ${instanceName} started successfully`);
        } catch (error) {
            console.error(`❌ Failed to start instance ${instanceName}: ${error.message}`);
            this.instances.delete(instanceName);
        }
    }

    /**
     * Stop monitoring an instance
     * @param {string} instanceName - Instance name
     */
    stopInstance(instanceName) {
        const manager = this.instances.get(instanceName);
        
        if (!manager) {
            console.log(`Instance ${instanceName} is not being monitored`);
            return;
        }

        console.log(`Stopping instance: ${instanceName}`);
        manager.stop();
        this.instances.delete(instanceName);
    }

    /**
     * Get status of all instances
     * @returns {Array} - Array of instance statuses
     */
    getStatus() {
        const statuses = [];
        
        for (const [name, manager] of this.instances) {
            statuses.push({
                name,
                ...manager.getStatus()
            });
        }
        
        return statuses;
    }

    /**
     * Display status table
     */
    displayStatus() {
        const statuses = this.getStatus();
        
        if (statuses.length === 0) {
            console.log('No instances are being monitored');
            return;
        }

        console.log('\n📊 Instance Status:');
        console.log('─'.repeat(80));
        console.log('Instance Name'.padEnd(20) + 'Status'.padEnd(12) + 'PID'.padEnd(10) + 'Uptime'.padEnd(12) + 'Restarts');
        console.log('─'.repeat(80));

        for (const status of statuses) {
            const statusText = status.running ? '🟢 Running' : '🔴 Stopped';
            const pid = status.pid ? status.pid.toString() : 'N/A';
            const uptime = status.uptime ? `${status.uptime}s` : 'N/A';
            const restarts = `${status.restartCount}/${status.maxRestarts}`;

            console.log(
                status.name.padEnd(20) +
                statusText.padEnd(12) +
                pid.padEnd(10) +
                uptime.padEnd(12) +
                restarts
            );
        }
        console.log('─'.repeat(80));
    }

    /**
     * Start all instances from configs directory
     */
    async startAllInstances() {
        const configsDir = path.join(__dirname, 'configs');
        
        if (!fs.existsSync(configsDir)) {
            console.error('Configs directory not found');
            return;
        }

        const configFiles = fs.readdirSync(configsDir)
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(configsDir, file));

        console.log(`Found ${configFiles.length} config file(s)`);

        for (const configFile of configFiles) {
            await this.startInstance(configFile);
            // Small delay between starts
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    /**
     * Stop all instances
     */
    stopAllInstances() {
        console.log('Stopping all instances...');
        
        for (const [name] of this.instances) {
            this.stopInstance(name);
        }
    }
}

// CLI Interface
if (require.main === module) {
    const monitor = new InstanceMonitor();
    const command = process.argv[2];

    // Handle shutdown
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT, stopping all instances...');
        monitor.stopAllInstances();
        setTimeout(() => process.exit(0), 5000);
    });

    switch (command) {
        case 'start':
            const configFile = process.argv[3];
            if (!configFile) {
                console.error('Usage: node instance-monitor.js start <config-file>');
                process.exit(1);
            }
            monitor.startInstance(configFile).then(() => {
                console.log('Press Ctrl+C to stop monitoring');
            });
            break;

        case 'start-all':
            monitor.startAllInstances().then(() => {
                console.log('All instances started. Press Ctrl+C to stop all');
            });
            break;

        case 'status':
            monitor.displayStatus();
            process.exit(0);
            break;

        default:
            console.log('Discord Relay Bot Instance Monitor');
            console.log('');
            console.log('Commands:');
            console.log('  start <config-file>  - Start monitoring a specific instance');
            console.log('  start-all           - Start monitoring all instances from configs/');
            console.log('  status              - Show status of all monitored instances');
            console.log('');
            console.log('Examples:');
            console.log('  node instance-monitor.js start configs/example-bot.json');
            console.log('  node instance-monitor.js start-all');
            console.log('  node instance-monitor.js status');
            process.exit(0);
    }

    // Keep process alive
    setInterval(() => {
        // Update status every 30 seconds when running
        if (command === 'start' || command === 'start-all') {
            console.clear();
            monitor.displayStatus();
        }
    }, 30000);
}

module.exports = InstanceMonitor;
