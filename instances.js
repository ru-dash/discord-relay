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
  node instances.js <command> [instance-name] [options...]

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
  fetch-reactions <name> <message-id> [channel-id] - Fetch reactions for a message

Examples:
  node instances.js create bot1
  node instances.js start bot1
  node instances.js start-all
  node instances.js list
  node instances.js logs bot1
  node instances.js fetch-reactions bot1 123456789012345678
  node instances.js fetch-reactions bot1 123456789012345678 987654321098765432

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

async function fetchReactions(instanceName, messageId, channelId) {
    // Validate message ID format (Discord snowflake)
    if (!/^\d{17,19}$/.test(messageId)) {
        console.error('Invalid message ID format. Discord message IDs should be 17-19 digit numbers.');
        console.log('Example: 123456789012345678');
        return;
    }

    // Validate channel ID format if provided
    if (channelId && !/^\d{17,19}$/.test(channelId)) {
        console.error('Invalid channel ID format. Discord channel IDs should be 17-19 digit numbers.');
        console.log('Example: 987654321098765432');
        return;
    }

    // Check if instance is running
    const statuses = instanceManager.getInstancesStatus();
    const instanceStatus = statuses.find(s => s.name === instanceName);
    
    if (!instanceStatus || !instanceStatus.running) {
        console.error(`Instance ${instanceName} is not running. Please start it first.`);
        return;
    }

    // Create commands directory if it doesn't exist
    const commandsDir = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsDir)) {
        fs.mkdirSync(commandsDir, { recursive: true });
    }

    // Create command file
    const commandId = `fetch-reactions-${Date.now()}`;
    const commandFile = path.join(commandsDir, `${instanceName}-${commandId}.json`);
    const resultFile = path.join(commandsDir, `${instanceName}-${commandId}-result.json`);

    const command = {
        type: 'fetch-reactions',
        messageId: messageId,
        channelId: channelId,
        timestamp: new Date().toISOString(),
        resultFile: resultFile
    };

    try {
        // Write command file
        fs.writeFileSync(commandFile, JSON.stringify(command, null, 2));
        console.log(`\n=== Fetching Reactions ===`);
        console.log(`Instance: ${instanceName}`);
        console.log(`Message ID: ${messageId}`);
        if (channelId) {
            console.log(`Channel ID: ${channelId}`);
        }
        console.log(`Command sent, waiting for response...`);

        // Wait for result file with timeout
        const timeout = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            if (fs.existsSync(resultFile)) {
                try {
                    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
                    
                    // Clean up files
                    try {
                        if (fs.existsSync(commandFile)) {
                            fs.unlinkSync(commandFile);
                        }
                        if (fs.existsSync(resultFile)) {
                            fs.unlinkSync(resultFile);
                        }
                    } catch (cleanupError) {
                        console.warn(`Warning: Could not clean up files: ${cleanupError.message}`);
                    }

                    if (result.error) {
                        console.error(`\nError: ${result.error}`);
                        return;
                    }

                    // Display reactions
                    console.log(`\n=== Reactions for Message ${messageId} ===`);
                    if (result.channelName) {
                        console.log(`Channel: #${result.channelName} (${result.channelId})`);
                    }
                    if (result.guildName) {
                        console.log(`Guild: ${result.guildName} (${result.guildId})`);
                    }
                    console.log(`Message URL: ${result.messageUrl || 'N/A'}`);
                    console.log('');

                    if (result.reactions && result.reactions.length > 0) {
                        console.log('Reactions:');
                        result.reactions.forEach(reaction => {
                            const emoji = reaction.emoji.name || reaction.emoji.id;
                            console.log(`  ${emoji}: ${reaction.count} users`);
                            if (reaction.users && reaction.users.length > 0) {
                                console.log(`    Users: ${reaction.users.join(', ')}`);
                            }
                        });
                    } else {
                        console.log('No reactions found on this message.');
                    }
                    
                    console.log(`\n=== Fetch completed ===`);
                    return;
                } catch (parseError) {
                    console.error(`Error parsing result: ${parseError.message}`);
                    // Clean up files on parse error
                    try {
                        if (fs.existsSync(commandFile)) {
                            fs.unlinkSync(commandFile);
                        }
                        if (fs.existsSync(resultFile)) {
                            fs.unlinkSync(resultFile);
                        }
                    } catch (cleanupError) {
                        console.warn(`Warning: Could not clean up files after parse error: ${cleanupError.message}`);
                    }
                    return;
                }
            }
            
            // Check every 500ms
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Timeout reached
        console.error('\nTimeout: No response received from instance within 30 seconds.');
        console.error('Make sure the instance is running and responding properly.');
        
        // Clean up command file
        if (fs.existsSync(commandFile)) {
            fs.unlinkSync(commandFile);
        }

    } catch (error) {
        console.error(`Error sending command: ${error.message}`);
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

            case 'fetch-reactions':
                if (!instanceName) {
                    console.error('Please provide an instance name');
                    console.log('Usage: node instances.js fetch-reactions <instance-name> <message-id> [channel-id]');
                    return;
                }
                const messageId = args[2];
                const channelId = args[3]; // Optional
                if (!messageId) {
                    console.error('Please provide a message ID');
                    console.log('Usage: node instances.js fetch-reactions <instance-name> <message-id> [channel-id]');
                    return;
                }
                await fetchReactions(instanceName, messageId, channelId);
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
