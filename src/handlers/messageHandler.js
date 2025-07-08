const MessageUtils = require('../utils/messageUtils');

class MessageHandler {
    constructor(databaseManager, webhookManager, cacheManager, performanceStats, autoUpdater, configManager) {
        this.databaseManager = databaseManager;
        this.webhookManager = webhookManager;
        this.cacheManager = cacheManager;
        this.performanceStats = performanceStats;
        this.autoUpdater = autoUpdater;
        this.configManager = configManager;
        this.channelWebhookMap = new Map();
        this.messageDebounceMap = new Map();
        this.MESSAGE_DEBOUNCE_TIME = 100; // 100ms debounce
    }

    /**
     * Set channel webhook mappings
     * @param {Map} channelWebhookMap - Channel ID to webhook URL mappings
     */
    setChannelMappings(channelWebhookMap) {
        this.channelWebhookMap = channelWebhookMap;
    }

    /**
     * Handle new message creation
     * @param {Object} message - Discord message object
     */
    handleMessageCreate(message) {
        try {
            // Debounce rapid messages from same author
            const debounceKey = `${message.author.id}-${message.channel.id}`;
            if (this.messageDebounceMap.has(debounceKey)) {
                clearTimeout(this.messageDebounceMap.get(debounceKey));
            }
            
            this.messageDebounceMap.set(debounceKey, setTimeout(() => {
                this.messageDebounceMap.delete(debounceKey);
                this.processMessage(message);
            }, this.MESSAGE_DEBOUNCE_TIME));
            
        } catch (error) {
            console.error('Error processing messageCreate:', error.message);
            this.performanceStats.errors++;
        }
    }

    /**
     * Handle message update
     * @param {Object} oldMessage - Old Discord message object
     * @param {Object} newMessage - New Discord message object
     */
    handleMessageUpdate(oldMessage, newMessage) {
        try {
            console.log(`Message update received: Channel ${newMessage.channel.id}, Guild ${newMessage.guild?.id || 'DM'}`);
            
            // Skip if not from a relayed guild
            if (!newMessage.guild || !this.cacheManager.isRelayedGuild(newMessage.guild.id)) {
                console.log('Skipping message update from non-relayed guild');
                return;
            }

            // Check if we have a webhook mapping for this channel
            let webhookUrl = this.channelWebhookMap.get(newMessage.channel.id);
            
            // If no legacy mapping, check new pattern-based mappings
            if (!webhookUrl && this.configManager) {
                const mappingResult = this.configManager.getWebhookForChannel(
                    newMessage.channel.id,
                    newMessage.channel.name,
                    newMessage.guild.id
                );
                
                if (mappingResult) {
                    webhookUrl = mappingResult.webhookUrl;
                }
            }
            
            if (webhookUrl) {
                console.log('Attempting to update message via webhook');
                this.webhookManager.sendToWebhook(
                    newMessage,
                    webhookUrl,
                    (msg) => MessageUtils.resolveMentions(msg, this.cacheManager),
                    MessageUtils.sanitizeMessage,
                    MessageUtils.sanitizeEmbeds,
                    true // isUpdate
                );
            } else {
                console.log('No webhook mapping found for message update');
            }
            
            // Update message content in database without affecting relationship fields
            this.updateMessageContentInDB(newMessage);
            this.performanceStats.messagesProcessed++;
        } catch (error) {
            console.error('Error processing messageUpdate:', error.message);
            this.performanceStats.errors++;
        }
    }

    /**
     * Update message content in database without affecting relationship fields
     * @param {Object} message - Discord message object
     */
    updateMessageContentInDB(message) {
        if (!message.guild || !this.cacheManager.isRelayedGuild(message.guild.id)) return;

        const messageData = MessageUtils.createMessageData(message);
        this.databaseManager.updateMessageContent(messageData);
    }

    /**
     * Process a message (internal method)
     * @param {Object} message - Discord message object
     */
    processMessage(message) {
        // Skip ephemeral messages
        if (message.flags?.has('EPHEMERAL')) {
            return;
        }
        
        // Skip if not from a guild
        if (!message.guild) {
            return;
        }
        
        // Skip if not from a relayed guild
        if (!this.cacheManager.isRelayedGuild(message.guild.id)) {
            return;
        }

        // Process webhook operations - they will handle database saving
        Promise.allSettled([
            this.sendToWebhookIfMapped(message),
            this.checkEveryoneCatch(message)
        ]).then(() => {
            // If no webhook was sent, save to database via batch
            this.saveMessageToDBIfNeeded(message);
            this.performanceStats.messagesProcessed++;
        }).catch(error => {
            console.error('Error processing message:', error.message);
            this.performanceStats.errors++;
        });
    }

    /**
     * Send message to webhook if mapping exists
     * @param {Object} message - Discord message object
     */
    async sendToWebhookIfMapped(message) {
        // First check legacy channel ID mappings
        let webhookUrl = this.channelWebhookMap.get(message.channel.id);
        let redactChannelName = false;
        
        // If no legacy mapping, check new pattern-based mappings
        if (!webhookUrl && this.configManager) {
            const mappingResult = this.configManager.getWebhookForChannel(
                message.channel.id,
                message.channel.name,
                message.guild.id
            );
            
            if (mappingResult) {
                webhookUrl = mappingResult.webhookUrl;
                redactChannelName = mappingResult.redactChannelName;
            }
        }
        
        if (webhookUrl) {
            // Ensure the original message is saved to the database immediately
            // before sending the webhook, so the relationship can be established
            if (message.guild && this.cacheManager.isRelayedGuild(message.guild.id)) {
                const messageData = MessageUtils.createMessageData(message);
                await this.databaseManager.saveMessageImmediate(messageData);
                
                // Mark this message as already saved
                if (!this.recentlySavedMessages) {
                    this.recentlySavedMessages = new Set();
                }
                this.recentlySavedMessages.add(message.id);
            }
            
            this.webhookManager.sendToWebhook(
                message,
                webhookUrl,
                (msg) => MessageUtils.resolveMentions(msg, this.cacheManager),
                MessageUtils.sanitizeMessage,
                MessageUtils.sanitizeEmbeds,
                false, // isUpdate
                redactChannelName
            );
        }
    }

    /**
     * Check for @everyone, @here, or role mentions and send to everyone catch webhook
     * @param {Object} message - Discord message object
     */
    async checkEveryoneCatch(message) {
        if (!this.configManager) return;

        const everyoneCatchWebhook = this.configManager.getEveryoneCatchWebhook(message.guild.id);
        if (!everyoneCatchWebhook) return;

        // Check for @everyone or @here mentions
        const hasEveryoneHere = message.content.includes('@everyone') || message.content.includes('@here');
        
        // Check for role mentions
        const hasRoleMentions = message.mentions.roles.size > 0;

        if (hasEveryoneHere || hasRoleMentions) {
            console.log(`Everyone catch triggered in ${message.guild.name}#${message.channel.name}: @everyone=${message.content.includes('@everyone')}, @here=${message.content.includes('@here')}, roles=${message.mentions.roles.size}`);
            
            // Ensure the original message is saved to the database immediately
            // before sending the webhook, so the relationship can be established
            if (message.guild && this.cacheManager.isRelayedGuild(message.guild.id)) {
                const messageData = MessageUtils.createMessageData(message);
                await this.databaseManager.saveMessageImmediate(messageData);
                
                // Mark this message as already saved
                if (!this.recentlySavedMessages) {
                    this.recentlySavedMessages = new Set();
                }
                this.recentlySavedMessages.add(message.id);
            }
            
            // Relay the message normally using the standard webhook format
            // Everyone catch messages always redact channel names for privacy
            this.webhookManager.sendToWebhook(
                message,
                everyoneCatchWebhook,
                (msg) => MessageUtils.resolveMentions(msg, this.cacheManager),
                MessageUtils.sanitizeMessage,
                MessageUtils.sanitizeEmbeds,
                false, // isUpdate
                true   // redactChannelName - always redact for everyone catch
            );
        }
    }

    /**
     * Save message to database
     * @param {Object} message - Discord message object
     */
    saveMessageToDB(message) {
        if (!message.guild || !this.cacheManager.isRelayedGuild(message.guild.id)) return;

        const messageData = MessageUtils.createMessageData(message);
        this.databaseManager.addMessageToBatch(messageData);
    }

    /**
     * Save message to database if it hasn't been saved already
     * @param {Object} message - Discord message object
     */
    saveMessageToDBIfNeeded(message) {
        if (!message.guild || !this.cacheManager.isRelayedGuild(message.guild.id)) return;

        // Check if message was already saved immediately (for webhook messages)
        // We'll track this using a simple Set of recently saved message IDs
        if (!this.recentlySavedMessages) {
            this.recentlySavedMessages = new Set();
        }

        if (!this.recentlySavedMessages.has(message.id)) {
            const messageData = MessageUtils.createMessageData(message);
            this.databaseManager.addMessageToBatch(messageData);
        }
        
        // Clean up old entries periodically
        if (this.recentlySavedMessages.size > 1000) {
            this.recentlySavedMessages.clear();
        }
    }

    /**
     * Handle debug command
     * @param {Object} message - Discord message object
     * @param {Object} client - Discord client
     */
    handleDebugCommand(message, client) {
        if (message.author.id !== client.user.id) {
            return false;
        }

        if (message.content === '!relay-test') {
            console.log('=== RELAY DEBUG INFO ===');
            console.log(`Bot user ID: ${client.user.id}`);
            console.log(`Current guild: ${message.guild?.name || 'DM'} (${message.guild?.id || 'N/A'})`);
            console.log(`Current channel: ${message.channel.name} (${message.channel.id})`);
            console.log(`Relayed guild IDs: ${Array.from(this.cacheManager.relayedGuildIds).join(', ')}`);
            console.log(`Channel webhook mappings: ${Array.from(this.channelWebhookMap.keys()).join(', ')}`);
            console.log(`Is guild relayed: ${this.cacheManager.isRelayedGuild(message.guild?.id)}`);
            console.log(`Has webhook for channel: ${this.channelWebhookMap.has(message.channel.id)}`);
            console.log('========================');
            return true;
        }

        if (message.content === '!relay-update') {
            console.log('=== MANUAL UPDATE CHECK ===');
            if (this.autoUpdater) {
                this.autoUpdater.forceUpdateCheck().then(updateAvailable => {
                    if (!updateAvailable) {
                        console.log('No update available or check failed');
                    }
                }).catch(error => {
                    console.error('Update check error:', error.message);
                });
            } else {
                console.log('Auto updater not available');
            }
            console.log('============================');
            return true;
        }

        return false;
    }

    /**
     * Clear all debounce timers
     */
    clearDebounceTimers() {
        this.messageDebounceMap.forEach(timer => clearTimeout(timer));
        this.messageDebounceMap.clear();
    }
}

module.exports = MessageHandler;
