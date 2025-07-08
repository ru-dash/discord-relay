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
                case 'fetch-guild-channels':
                    result = await this.handleFetchGuildChannels(commandData);
                    break;
                case 'search-user':
                    result = await this.handleSearchUser(commandData);
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

    /**
     * Handle fetch-guild-channels command
     * @param {Object} commandData - Command data
     * @returns {Object} - Result object
     */
    async handleFetchGuildChannels(commandData) {
        try {
            const { guildId, guildNameFilter, showPermissions = true } = commandData;
            console.log(`[${this.instanceName}] Fetching guild channels${guildId ? ` for guild ${guildId}` : guildNameFilter ? ` for guilds containing "${guildNameFilter}"` : ' for all accessible guilds'}`);

            const guilds = [];
            let targetGuilds;
            
            if (guildId) {
                // Specific guild ID
                targetGuilds = [this.client.guilds.cache.get(guildId)].filter(Boolean);
            } else if (guildNameFilter) {
                // Filter by guild name (case insensitive)
                targetGuilds = Array.from(this.client.guilds.cache.values())
                    .filter(guild => guild.name.toLowerCase().includes(guildNameFilter.toLowerCase()));
            } else {
                // All guilds
                targetGuilds = Array.from(this.client.guilds.cache.values());
            }

            if (targetGuilds.length === 0) {
                return { error: guildId ? `Guild ${guildId} not found or not accessible` : 
                    guildNameFilter ? `No guilds found containing "${guildNameFilter}"` : 'No accessible guilds found' };
            }

            for (const guild of targetGuilds) {
                try {
                    console.log(`[${this.instanceName}] Processing guild: ${guild.name} (${guild.id})`);
                    
                    // Get all channels
                    const channels = Array.from(guild.channels.cache.values())
                        .filter(channel => 
                            channel.type === 'GUILD_TEXT' || 
                            channel.type === 'GUILD_NEWS' || 
                            channel.type === 'GUILD_VOICE' ||
                            channel.type === 'GUILD_STAGE_VOICE' ||
                            channel.type === 'GUILD_CATEGORY'
                        )
                        .sort((a, b) => {
                            // Sort by position, then by name
                            if (a.position !== b.position) {
                                return a.position - b.position;
                            }
                            return a.name.localeCompare(b.name);
                        });

                    // Group channels by category
                    const categorizedChannels = {};
                    const uncategorizedChannels = [];

                    for (const channel of channels) {
                        if (channel.type === 'GUILD_CATEGORY') {
                            categorizedChannels[channel.id] = {
                                name: channel.name,
                                position: channel.position,
                                channels: []
                            };
                        } else if (channel.parentId && categorizedChannels[channel.parentId]) {
                            const hasAccess = showPermissions ? this.checkChannelAccess(channel) : true;
                            const lastMessageInfo = await this.getLastMessageInfo(channel);
                            categorizedChannels[channel.parentId].channels.push({
                                id: channel.id,
                                name: channel.name,
                                type: this.getChannelTypeSymbol(channel.type),
                                hasAccess: hasAccess,
                                position: channel.position,
                                lastMessageId: lastMessageInfo.id,
                                lastMessageDate: lastMessageInfo.date
                            });
                        } else if (channel.type !== 'GUILD_CATEGORY') {
                            const hasAccess = showPermissions ? this.checkChannelAccess(channel) : true;
                            const lastMessageInfo = await this.getLastMessageInfo(channel);
                            uncategorizedChannels.push({
                                id: channel.id,
                                name: channel.name,
                                type: this.getChannelTypeSymbol(channel.type),
                                hasAccess: hasAccess,
                                position: channel.position,
                                lastMessageId: lastMessageInfo.id,
                                lastMessageDate: lastMessageInfo.date
                            });
                        }
                    }

                    // Sort channels within categories
                    Object.values(categorizedChannels).forEach(category => {
                        category.channels.sort((a, b) => a.position - b.position);
                    });
                    uncategorizedChannels.sort((a, b) => a.position - b.position);

                    const guildData = {
                        id: guild.id,
                        name: guild.name,
                        memberCount: guild.memberCount,
                        categories: categorizedChannels,
                        uncategorizedChannels: uncategorizedChannels,
                        totalChannels: channels.filter(ch => ch.type !== 'GUILD_CATEGORY').length
                    };

                    guilds.push(guildData);
                    console.log(`[${this.instanceName}] Processed ${guildData.totalChannels} channels in guild ${guild.name}`);

                } catch (error) {
                    console.error(`[${this.instanceName}] Error processing guild ${guild.name}:`, error.message);
                    guilds.push({
                        id: guild.id,
                        name: guild.name,
                        error: `Failed to process guild: ${error.message}`
                    });
                }
            }

            const result = {
                guilds: guilds,
                totalGuilds: guilds.length,
                showPermissions: showPermissions,
                timestamp: new Date().toISOString()
            };

            console.log(`[${this.instanceName}] Successfully fetched channels for ${guilds.length} guild(s)`);
            return result;

        } catch (error) {
            console.error(`[${this.instanceName}] Error in handleFetchGuildChannels:`, error.message);
            return { error: `Failed to fetch guild channels: ${error.message}` };
        }
    }

    /**
     * Get last message information for a channel
     * @param {Object} channel - Discord channel object
     * @returns {Object} - Object containing last message ID and formatted date
     */
    async getLastMessageInfo(channel) {
        try {
            // Skip voice channels as they don't have messages
            if (channel.type === 'GUILD_VOICE' || channel.type === 'GUILD_STAGE_VOICE') {
                return { id: null, date: null };
            }

            const lastMessageId = channel.lastMessageId;
            if (!lastMessageId) {
                return { id: null, date: null };
            }

            // Try to get the message to get the actual timestamp
            let messageDate = null;
            try {
                const message = await channel.messages.fetch(lastMessageId);
                messageDate = this.formatDateToUTC(message.createdAt);
            } catch (error) {
                // If we can't fetch the message, try to extract date from snowflake
                try {
                    const timestamp = this.snowflakeToTimestamp(lastMessageId);
                    messageDate = this.formatDateToUTC(new Date(timestamp));
                } catch (snowflakeError) {
                    messageDate = "Unknown date";
                }
            }

            return {
                id: lastMessageId,
                date: messageDate
            };
        } catch (error) {
            return { id: null, date: null };
        }
    }

    /**
     * Convert Discord snowflake to timestamp
     * @param {string} snowflake - Discord snowflake ID
     * @returns {number} - Timestamp in milliseconds
     */
    snowflakeToTimestamp(snowflake) {
        const DISCORD_EPOCH = 1420070400000; // Discord epoch (January 1, 2015)
        return parseInt(snowflake) / 4194304 + DISCORD_EPOCH;
    }

    /**
     * Format date to UTC string
     * @param {Date} date - Date object
     * @returns {string} - Formatted date string
     */
    formatDateToUTC(date) {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
            return "Invalid date";
        }

        const options = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC'
        };

        return date.toLocaleDateString('en-US', options);
    }

    /**
     * Check if bot has access to a channel
     * @param {Object} channel - Discord channel object
     * @returns {boolean} - True if bot can view the channel
     */
    checkChannelAccess(channel) {
        try {
            const guild = channel.guild;
            const botMember = guild.members.cache.get(this.client.user.id);
            
            if (!botMember) return false;
            
            const permissions = channel.permissionsFor(botMember);
            return permissions && permissions.has('VIEW_CHANNEL');
        } catch (error) {
            return false;
        }
    }

    /**
     * Handle search user command
     * @param {Object} commandData - Command data containing discordId
     * @returns {Promise<Object>} - Search results
     */
    async handleSearchUser(commandData) {
        const { discordId } = commandData;
        
        try {
            console.log(`[${this.instanceName}] Searching for user: ${discordId}`);
            
            if (!this.databaseManager) {
                return { error: 'Database manager not available' };
            }

            // Search the database for the user
            const userResults = await this.databaseManager.searchUserByDiscordId(discordId);
            
            if (userResults.length === 0) {
                return { 
                    success: true, 
                    discordId,
                    guilds: [],
                    message: 'User not found in any guilds'
                };
            }

            // Group results by guild to avoid duplicates
            const guildMap = new Map();
            
            for (const result of userResults) {
                const guildKey = result.guild_id;
                
                if (!guildMap.has(guildKey)) {
                    guildMap.set(guildKey, {
                        guildId: result.guild_id,
                        guildName: result.guild_name,
                        displayName: result.display_name,
                        status: result.status,
                        roles: result.roles || [],
                        lastSeen: result.last_seen,
                        channels: []
                    });
                }
                
                // Add channel info if available
                const guild = guildMap.get(guildKey);
                if (result.channel_id && !guild.channels.find(ch => ch.channelId === result.channel_id)) {
                    guild.channels.push({
                        channelId: result.channel_id,
                        channelName: result.channel_name
                    });
                }
            }

            const guilds = Array.from(guildMap.values());
            
            console.log(`[${this.instanceName}] Found user in ${guilds.length} guilds`);
            
            return {
                success: true,
                discordId,
                guilds,
                message: `User found in ${guilds.length} guild${guilds.length !== 1 ? 's' : ''}`
            };
            
        } catch (error) {
            console.error(`[${this.instanceName}] Error searching for user:`, error.message);
            return { 
                error: `Failed to search for user: ${error.message}` 
            };
        }
    }

    /**
     * Get symbol for channel type
     * @param {string} channelType - Discord channel type
     * @returns {string} - Symbol representing the channel type
     */
    getChannelTypeSymbol(channelType) {
        switch (channelType) {
            case 'GUILD_TEXT':
                return '#';
            case 'GUILD_NEWS':
                return '📢';
            case 'GUILD_VOICE':
                return '🔊';
            case 'GUILD_STAGE_VOICE':
                return '🎤';
            default:
                return '?';
        }
    }

    // ...existing code...
}

module.exports = CommandProcessor;
