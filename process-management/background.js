#!/usr/bin/env node

const InstanceManager = require('./src/instance/instanceManager');

const instanceManager = new InstanceManager();

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const instanceName = args[1];

async function main() {
    if (!command) {
        console.error('No command provided');
        process.exit(1);
    }

    try {
        switch (command.toLowerCase()) {
            case 'start':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    process.exit(1);
                }
                const child = instanceManager.startInstance(instanceName);
                if (child) {
                    console.log(`Instance ${instanceName} started in background (PID: ${child.pid})`);
                    console.log(`Use 'node instances.js logs ${instanceName}' to view logs`);
                    console.log(`Use 'node instances.js list' to check status`);
                    
                    // Exit immediately to return control to terminal
                    process.exit(0);
                } else {
                    console.log(`Instance ${instanceName} may already be running. Check 'node instances.js list' for status.`);
                    process.exit(0);
                }
                break;

            case 'stop':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    process.exit(1);
                }
                instanceManager.stopInstance(instanceName);
                // Give it a moment to send the signal
                setTimeout(() => {
                    process.exit(0);
                }, 500);
                break;

            case 'stop-all':
                instanceManager.stopAllInstances();
                // Give it a moment to send signals to all processes
                setTimeout(() => {
                    process.exit(0);
                }, 1000);
                break;

            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
