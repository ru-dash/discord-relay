#!/usr/bin/env node

const InstanceManager = require('./src/instance/instanceManager');
const path = require('path');
const fs = require('fs');

const instanceManager = new InstanceManager();

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const instanceName = args[1];

function printUsage() {
    console.log(`
Discord Relay Bot - Multi-Instance Manager

Usage:
  node instances.js <command> [instance-name]

Commands:
  create <name>     - Create a new instance configuration template
  start <name>      - Start a specific instance
  stop <name>       - Stop a specific instance
  restart <name>    - Restart a specific instance
  start-all         - Start all configured instances
  stop-all          - Stop all running instances
  list              - List all configured instances and their status
  logs <name>       - Show logs for a specific instance
  config <name>     - Show configuration path for an instance

Examples:
  node instances.js create bot1
  node instances.js start bot1
  node instances.js start-all
  node instances.js list
  node instances.js logs bot1

Instance configurations are stored in: ./configs/
Instance databases are stored in: ./databases/
Instance logs are stored in: ./logs/
`);
}

async function showLogs(instanceName) {
    const fs = require('fs');
    const logFile = path.join(__dirname, 'logs', `${instanceName}.log`);
    
    if (!fs.existsSync(logFile)) {
        console.log(`No log file found for instance: ${instanceName}`);
        return;
    }

    console.log(`\n=== Logs for ${instanceName} ===`);
    try {
        const logs = fs.readFileSync(logFile, 'utf8');
        const lines = logs.split('\n');
        
        // Show last 50 lines
        const recentLines = lines.slice(-50).filter(line => line.trim());
        recentLines.forEach(line => console.log(line));
        
        console.log(`\n=== End of logs (showing last ${recentLines.length} lines) ===`);
        console.log(`Full log file: ${logFile}`);
    } catch (error) {
        console.error(`Error reading log file: ${error.message}`);
    }
}

async function main() {
    if (!command) {
        printUsage();
        return;
    }

    try {
        switch (command.toLowerCase()) {
            case 'create':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js create <instance-name>');
                    return;
                }
                const configPath = instanceManager.generateTemplate(instanceName);
                console.log(`\nTemplate configuration created at: ${configPath}`);
                console.log('Please edit this file and add your Discord token and webhook URLs before starting the instance.');
                break;

            case 'start':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js start <instance-name>');
                    return;
                }
                const child = instanceManager.startInstance(instanceName);
                if (child) {
                    console.log(`Instance ${instanceName} started in background (PID: ${child.pid})`);
                    console.log(`Use 'node instances.js logs ${instanceName}' to view logs.`);
                    console.log(`Use 'node instances.js list' to check status.`);
                    
                    // Exit quickly to return control to terminal
                    setTimeout(() => {
                        process.exit(0);
                    }, 1500);
                } else {
                    console.log(`Instance ${instanceName} may already be running. Check 'node instances.js list' for status.`);
                }
                break;

            case 'stop':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js stop <instance-name>');
                    return;
                }
                instanceManager.stopInstance(instanceName);
                break;

            case 'restart':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js restart <instance-name>');
                    return;
                }
                console.log(`Restarting instance: ${instanceName}`);
                instanceManager.stopInstance(instanceName);
                setTimeout(() => {
                    instanceManager.startInstance(instanceName);
                }, 3000);
                break;

            case 'start-all':
                instanceManager.startAllInstances();
                break;

            case 'stop-all':
                instanceManager.stopAllInstances();
                break;

            case 'list':
                const statuses = instanceManager.getInstancesStatus();
                console.log('\n=== Instance Status ===');
                if (statuses.length === 0) {
                    console.log('No instances configured. Use "node instances.js create <name>" to create one.');
                } else {
                    statuses.forEach(status => {
                        const runningStatus = status.running ? '✓ RUNNING' : '✗ STOPPED';
                        const pidInfo = status.pid ? ` (PID: ${status.pid})` : '';
                        const startTime = status.startTime ? ` (since ${status.startTime.toLocaleString()})` : '';
                        const statusInfo = status.status && status.status !== 'stopped' ? ` [${status.status.toUpperCase()}]` : '';
                        
                        console.log(`${status.name}: ${runningStatus}${pidInfo}${statusInfo}${startTime}`);
                        console.log(`  Config: ${status.configPath}`);
                        console.log(`  Logs: ${status.logFile}`);
                        if (status.errorLogFile && fs.existsSync(status.errorLogFile)) {
                            console.log(`  Errors: ${status.errorLogFile}`);
                        }
                        console.log('');
                    });
                }
                break;

            case 'logs':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js logs <instance-name>');
                    return;
                }
                await showLogs(instanceName);
                break;

            case 'config':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js config <instance-name>');
                    return;
                }
                const configFilePath = path.join(__dirname, 'configs', `${instanceName}.json`);
                console.log(`Configuration file: ${configFilePath}`);
                break;

            default:
                console.error(`Unknown command: ${command}`);
                printUsage();
                break;
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down all instances...');
    instanceManager.stopAllInstances();
    setTimeout(() => {
        process.exit(0);
    }, 5000);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down all instances...');
    instanceManager.stopAllInstances();
    setTimeout(() => {
        process.exit(0);
    }, 5000);
});

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
