const fs = require('fs');
const path = require('path');

class CommandProcessor {
    constructor(client, configManager, instanceName, databaseManager = null) {
        this.client = client;
        this.configManager = configManager;
        this.instanceName = instanceName;
        this.databaseManager = databaseManager;
        this.commandsDir = path.join(__dirname, '../../commands');
        this.processingInterval = null;
        this.isProcessing = false;
    }

    /**
     * Start processing commands
     */
    start() {
        // Ensure commands directory exists
        if (!fs.existsSync(this.commandsDir)) {
            fs.mkdirSync(this.commandsDir, { recursive: true });
        }

        console.log(`[${this.instanceName}] Command processor started`);
        
        // Check for commands every 2 seconds
        this.processingInterval = setInterval(() => {
            this.processCommands();
        }, 2000);
    }

    /**
     * Stop processing commands
     */
    stop() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        console.log(`[${this.instanceName}] Command processor stopped`);
    }

    /**
     * Process pending commands
     */
    async processCommands() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            if (!fs.existsSync(this.commandsDir)) {
                return;
            }

            const files = fs.readdirSync(this.commandsDir);
            const commandFiles = files.filter(file => 
                file.startsWith(`${this.instanceName}-`) && 
                file.endsWith('.json') && 
                !file.includes('-result')
            );

            for (const commandFile of commandFiles) {
                try {
                    await this.processCommandFile(commandFile);
                } catch (error) {
                    console.error(`[${this.instanceName}] Error processing command file ${commandFile}:`, error.message);
                }
            }
        } catch (error) {
            console.error(`[${this.instanceName}] Error in command processing:`, error.message);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process a single command file
     * @param {string} commandFile - Name of the command file
     */
    async processCommandFile(commandFile) {
        const commandPath = path.join(this.commandsDir, commandFile);
        
        try {
            const commandData = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
            console.log(`[${this.instanceName}] Processing command: ${commandData.type}`);

            let result = {};

            switch (commandData.type) {
                case 'fetch-reactions':
                    result = await this.handleFetchReactions(commandData);
                    break;
                default:
                    result = { error: `Unknown command type: ${commandData.type}` };
                    break;
            }

            // Write result file
            if (commandData.resultFile) {
                fs.writeFileSync(commandData.resultFile, JSON.stringify(result, null, 2));
            }

            // Remove command file
            fs.unlinkSync(commandPath);

        } catch (error) {
            console.error(`[${this.instanceName}] Error processing command file:`, error.message);
            
            // Try to write error result
            try {
                const commandData = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
                if (commandData.resultFile) {
                    fs.writeFileSync(commandData.resultFile, JSON.stringify({
                        error: `Command processing failed: ${error.message}`
                    }, null, 2));
                }
            } catch (writeError) {
                console.error(`[${this.instanceName}] Failed to write error result:`, writeError.message);
            }

            // Remove command file
            try {
                fs.unlinkSync(commandPath);
            } catch (unlinkError) {
                console.error(`[${this.instanceName}] Failed to remove command file:`, unlinkError.message);
            }
        }
    }

    /**
     * Handle fetch-reactions command
     * @param {Object} commandData - Command data
     * @returns {Object} - Result object
     */
    async handleFetchReactions(commandData) {
        try {
            const { messageId, channelId } = commandData;
            console.log(`[${this.instanceName}] Fetching reactions for message ${messageId}${channelId ? ` in channel ${channelId}` : ''}`);

            let message = null;
            let channel = null;
            let targetChannelId = channelId;
            let targetMessageId = messageId; // Use this for the actual message fetch
            let messageInfo = null; // Track message info for result formatting

            // If no channel ID provided, try to find it in the database first
            if (!targetChannelId && this.databaseManager) {
                console.log(`[${this.instanceName}] Looking up message ${messageId} in database...`);
                
                // First check if this is a relayed message ID (prioritize reverse lookup)
                messageInfo = await this.databaseManager.findOriginalByRelayedId(messageId);
                if (messageInfo) {
                    console.log(`[${this.instanceName}] Found original message via relayed ID: ${messageInfo.messageId} in channel #${messageInfo.channelName} (${messageInfo.channelId}) in guild ${messageInfo.guildName}`);
                    targetChannelId = messageInfo.channelId;
                    targetMessageId = messageInfo.messageId;
                } else {
                    // Then check if it's an original message
                    messageInfo = await this.databaseManager.findMessageById(messageId);
                    if (messageInfo && messageInfo.isOriginal) {
                        console.log(`[${this.instanceName}] Found original message in database: channel #${messageInfo.channelName} (${messageInfo.channelId}) in guild ${messageInfo.guildName}`);
                        targetChannelId = messageInfo.channelId;
                    } else {
                        console.log(`[${this.instanceName}] Message ${messageId} not found in database, will try to detect if it's a relayed message via content matching...`);
                        
                        // Try to fetch the message first to get its content, then search for original
                        const relayedMessage = await this.tryFetchMessageFromDiscord(messageId);
                        if (relayedMessage && this.databaseManager) {
                            console.log(`[${this.instanceName}] Fetched potential relayed message, searching for original by content...`);
                            const originalInfo = await this.databaseManager.findOriginalByContent(
                                messageId, 
                                relayedMessage.content
                            );
                            
                            if (originalInfo) {
                                console.log(`[${this.instanceName}] Found original message via content match: ${originalInfo.messageId} in channel #${originalInfo.channelName} (${originalInfo.channelId}) in guild ${originalInfo.guildName}`);
                                targetChannelId = originalInfo.channelId;
                                targetMessageId = originalInfo.messageId;
                                messageInfo = originalInfo; // Store for result formatting
                            } else {
                                console.log(`[${this.instanceName}] No original message found via content match, will search Discord channels for ${messageId}...`);
                            }
                        } else {
                            console.log(`[${this.instanceName}] Could not fetch message ${messageId} from Discord, will search channels...`);
                        }
                    }
                }
            }

            if (targetChannelId) {
                // Look in specific channel (either provided or found in database)
                channel = this.client.channels.cache.get(targetChannelId);
                if (!channel) {
                    return { error: `Channel ${targetChannelId} not found or not accessible` };
                }

                try {
                    message = await channel.messages.fetch(targetMessageId);
                } catch (error) {
                    if (error.code === 10008) { // Unknown message
                        return { error: `Message ${targetMessageId} not found in channel #${channel.name}` };
                    } else if (error.code === 50001) { // Missing access
                        return { error: `No permission to read messages in channel #${channel.name}` };
                    } else {
                        return { error: `Failed to fetch message ${targetMessageId} from channel #${channel.name}: ${error.message}` };
                    }
                }
            } else {
                // Fallback: Search through accessible channels with timeout and rate limiting
                console.log(`[${this.instanceName}] Searching for message ${targetMessageId} across accessible channels...`);
                let searchedChannels = 0;
                const maxChannelsToSearch = 50; // Limit search to prevent timeout
                const searchStartTime = Date.now();
                const searchTimeout = 25000; // 25 second timeout for searching
                
                const channels = Array.from(this.client.channels.cache.values())
                    .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 'GUILD_NEWS')
                    .slice(0, maxChannelsToSearch); // Limit the number of channels to search
                
                console.log(`[${this.instanceName}] Will search ${channels.length} channels`);
                
                for (const cacheChannel of channels) {
                    // Check timeout
                    if (Date.now() - searchStartTime > searchTimeout) {
                        console.log(`[${this.instanceName}] Search timeout reached after ${searchedChannels} channels`);
                        break;
                    }
                    
                    searchedChannels++;
                    try {
                        message = await cacheChannel.messages.fetch(targetMessageId);
                        channel = cacheChannel;
                        console.log(`[${this.instanceName}] Found message in channel #${channel.name} (${channel.guild?.name}) after searching ${searchedChannels} channels`);
                        break;
                    } catch (error) {
                        // Message not in this channel, continue searching
                        if (searchedChannels % 10 === 0) {
                            console.log(`[${this.instanceName}] Searched ${searchedChannels} channels so far...`);
                        }
                        continue;
                    }
                    
                    // Small delay to prevent rate limiting
                    if (searchedChannels % 5 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }

                if (!message) {
                    return { 
                        error: `Message ${targetMessageId} not found in any of ${searchedChannels} searched channels. The message may not exist or the bot may not have access to it.` 
                    };
                }
            }

            // Fetch reactions
            console.log(`[${this.instanceName}] Fetching reactions from message...`);
            const reactions = [];
            
            if (message.reactions.cache.size === 0) {
                console.log(`[${this.instanceName}] No reactions found on message`);
            } else {
                console.log(`[${this.instanceName}] Found ${message.reactions.cache.size} reaction types`);
            }

            for (const [, reaction] of message.reactions.cache) {
                try {
                    // Fetch users who reacted
                    const users = await reaction.users.fetch();
                    const userDisplayNames = users.map(user => {
                        // Try to get display name from guild member
                        if (message.guild) {
                            const member = message.guild.members.cache.get(user.id);
                            return member?.displayName || user.username;
                        }
                        return user.username;
                    });

                    reactions.push({
                        emoji: {
                            name: reaction.emoji.name,
                            id: reaction.emoji.id,
                            animated: reaction.emoji.animated,
                            custom: reaction.emoji.id !== null
                        },
                        count: reaction.count,
                        users: userDisplayNames
                    });
                    
                    console.log(`[${this.instanceName}] Processed reaction ${reaction.emoji.name || reaction.emoji.id}: ${reaction.count} users`);
                } catch (error) {
                    console.error(`[${this.instanceName}] Error fetching users for reaction:`, error.message);
                    reactions.push({
                        emoji: {
                            name: reaction.emoji.name,
                            id: reaction.emoji.id,
                            animated: reaction.emoji.animated,
                            custom: reaction.emoji.id !== null
                        },
                        count: reaction.count,
                        users: [],
                        error: `Failed to fetch users: ${error.message}`
                    });
                }
            }

            // Build result
            const result = {
                queriedMessageId: messageId, // The message ID that was originally requested
                actualMessageId: targetMessageId, // The actual message ID used for fetching reactions
                channelId: channel.id,
                channelName: channel.name,
                reactions: reactions,
                messageUrl: `https://discord.com/channels/${message.guild?.id || '@me'}/${channel.id}/${targetMessageId}`
            };

            if (message.guild) {
                result.guildId = message.guild.id;
                result.guildName = message.guild.name;
            }

            // Add note if relayed message was used
            if (targetMessageId !== messageId) {
                if (messageInfo && messageInfo.foundVia === 'content-match') {
                    result.note = `Reactions fetched from original message ${targetMessageId} found via content matching (you provided relayed message ID ${messageId})`;
                } else {
                    result.note = `Reactions fetched from original message ${targetMessageId} (you provided relayed message ID ${messageId})`;
                }
            }

            console.log(`[${this.instanceName}] Successfully fetched ${reactions.length} reactions for message ${targetMessageId}${targetMessageId !== messageId ? ` (queried via relayed message ${messageId})` : ''}`);
            return result;

        } catch (error) {
            console.error(`[${this.instanceName}] Error in handleFetchReactions:`, error.message);
            return { error: `Failed to fetch reactions: ${error.message}` };
        }
    }

    /**
     * Try to fetch a message from Discord across accessible channels (prioritize webhook channels)
     * @param {string} messageId - Discord message ID
     * @returns {Promise<Object|null>} - Discord message object or null if not found
     */
    async tryFetchMessageFromDiscord(messageId) {
        try {
            // Get all accessible channels, but prioritize webhook/relay destination channels
            const allChannels = Array.from(this.client.channels.cache.values())
                .filter(ch => ch.type === 'GUILD_TEXT' || ch.type === 'GUILD_NEWS');
            
            // Get webhook destination channels from config (these are likely where relayed messages are)
            const webhookChannels = [];
            const regularChannels = [];
            
            // Split channels into webhook destinations and regular channels
            for (const channel of allChannels) {
                const isWebhookDestination = this.isLikelyWebhookChannel(channel);
                if (isWebhookDestination) {
                    webhookChannels.push(channel);
                } else {
                    regularChannels.push(channel);
                }
            }
            
            // Search webhook channels first (more likely to contain relayed messages)
            console.log(`[${this.instanceName}] Searching ${webhookChannels.length} webhook channels first for relayed message ${messageId}`);
            
            for (const channel of webhookChannels.slice(0, 5)) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    if (message) {
                        console.log(`[${this.instanceName}] Found message ${messageId} in webhook channel #${channel.name} for content analysis`);
                        return message;
                    }
                } catch (error) {
                    // Message not in this channel, continue
                    continue;
                }
            }
            
            // Then search regular channels
            console.log(`[${this.instanceName}] Searching additional channels for message ${messageId}`);
            for (const channel of regularChannels.slice(0, 10)) {
                try {
                    const message = await channel.messages.fetch(messageId);
                    if (message) {
                        console.log(`[${this.instanceName}] Found message ${messageId} in channel #${channel.name} for content analysis`);
                        return message;
                    }
                } catch (error) {
                    // Message not in this channel, continue
                    continue;
                }
            }
            
            return null;
        } catch (error) {
            console.warn(`[${this.instanceName}] Error trying to fetch message ${messageId} from Discord:`, error.message);
            return null;
        }
    }

    /**
     * Check if a channel is likely a webhook destination channel
     * @param {Object} channel - Discord channel object
     * @returns {boolean} - True if likely a webhook channel
     */
    isLikelyWebhookChannel(channel) {
        // This is a heuristic - you might want to customize this based on your setup
        const channelName = channel.name.toLowerCase();
        
        // Common patterns for relay/webhook channels
        const webhookPatterns = [
            'relay', 'webhook', 'mirror', 'feed', 'bridge', 
            'announcements', 'updates', 'notifications'
        ];
        
        return webhookPatterns.some(pattern => channelName.includes(pattern));
    }

    // ...existing code...
}

module.exports = CommandProcessor;
