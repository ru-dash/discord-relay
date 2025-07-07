const MessageUtils = require('../utils/messageUtils');

class MessageHandler {
    constructor(databaseManager, webhookManager, cacheManager, performanceStats, autoUpdater) {
        this.databaseManager = databaseManager;
        this.webhookManager = webhookManager;
        this.cacheManager = cacheManager;
        this.performanceStats = performanceStats;
        this.autoUpdater = autoUpdater;
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

            // Only process if we have a mapping
            if (this.webhookManager.hasMapping(oldMessage.id)) {
                console.log('Updating existing message via webhook');
                const webhookUrl = this.channelWebhookMap.get(newMessage.channel.id);
                if (webhookUrl) {
                    this.webhookManager.sendToWebhook(
                        newMessage,
                        webhookUrl,
                        (msg) => MessageUtils.resolveMentions(msg, this.cacheManager),
                        MessageUtils.sanitizeMessage,
                        MessageUtils.sanitizeEmbeds,
                        true // isUpdate
                    );
                }
            } else {
                console.log('No mapping found for message update');
            }
            
            this.saveMessageToDB(newMessage);
            this.performanceStats.messagesProcessed++;
        } catch (error) {
            console.error('Error processing messageUpdate:', error.message);
            this.performanceStats.errors++;
        }
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
        
        // Skip duplicate content
        if (this.cacheManager.isDuplicateContent(message)) {
            this.performanceStats.duplicatesSkipped++;
            return;
        }

        // Process webhook and database operations in parallel
        Promise.allSettled([
            this.sendToWebhookIfMapped(message),
            Promise.resolve(this.saveMessageToDB(message))
        ]).then(() => {
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
    sendToWebhookIfMapped(message) {
        const webhookUrl = this.channelWebhookMap.get(message.channel.id);
        if (webhookUrl) {
            this.webhookManager.sendToWebhook(
                message,
                webhookUrl,
                (msg) => MessageUtils.resolveMentions(msg, this.cacheManager),
                MessageUtils.sanitizeMessage,
                MessageUtils.sanitizeEmbeds,
                false // isUpdate
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
