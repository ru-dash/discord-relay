const axios = require('axios');
const FormData = require('form-data');

class WebhookManager {
    constructor() {
        this.webhookQueue = [];
        this.MAX_WEBHOOK_REQUESTS_PER_SECOND = 12;
        this.WEBHOOK_RATE_LIMIT_WINDOW = 1000;
        this.WEBHOOK_BURST_LIMIT = 20;
        this.webhookRequestCount = 0;
        this.webhookBurstCount = 0;
        this.webhookRateLimitReset = Date.now() + this.WEBHOOK_RATE_LIMIT_WINDOW;
        this.webhookResponseCache = new WeakMap();
        this.messageMappings = new Map();
        this.MAX_MESSAGE_MAPPINGS = 5000;
        this.performanceStats = null;
        this.axiosInstance = null;

        // Start processing queue
        setInterval(() => this.processWebhookQueue(), 50);
        
        // Cleanup message mappings every 15 minutes
        setInterval(() => this.cleanupMessageMappings(), 15 * 60 * 1000);
    }

    /**
     * Initialize webhook manager
     * @param {Object} axiosInstance - Configured axios instance
     * @param {Object} performanceStats - Performance statistics object
     * @param {Object} databaseManager - Database manager instance (optional)
     */
    initialize(axiosInstance, performanceStats, databaseManager = null) {
        this.axiosInstance = axiosInstance;
        this.performanceStats = performanceStats;
        this.databaseManager = databaseManager;
    }

    /**
     * Process webhook queue with rate limiting
     */
    async processWebhookQueue() {
        if (this.webhookQueue.length === 0) return;
        
        const now = Date.now();
        
        // Reset rate limit window if needed
        if (now >= this.webhookRateLimitReset) {
            this.webhookRequestCount = 0;
            this.webhookBurstCount = Math.max(0, this.webhookBurstCount - 5);
            this.webhookRateLimitReset = now + this.WEBHOOK_RATE_LIMIT_WINDOW;
        }
        
        // Calculate available requests (considering burst)
        const availableRequests = Math.min(
            this.webhookQueue.length,
            this.MAX_WEBHOOK_REQUESTS_PER_SECOND - this.webhookRequestCount,
            this.WEBHOOK_BURST_LIMIT - this.webhookBurstCount
        );
        
        if (availableRequests <= 0) return;
        
        // Process requests in parallel batches
        const requestBatch = this.webhookQueue.splice(0, availableRequests);
        this.webhookRequestCount += requestBatch.length;
        this.webhookBurstCount += requestBatch.length;
        
        // Process up to 3 requests in parallel
        const PARALLEL_LIMIT = 3;
        for (let i = 0; i < requestBatch.length; i += PARALLEL_LIMIT) {
            const batch = requestBatch.slice(i, i + PARALLEL_LIMIT);
            await Promise.allSettled(batch.map(request => request()));
        }
    }

    /**
     * Clean up old message mappings
     */
    cleanupMessageMappings() {
        if (this.messageMappings.size > this.MAX_MESSAGE_MAPPINGS) {
            const keysToDelete = Array.from(this.messageMappings.keys())
                .slice(0, Math.floor(this.messageMappings.size * 0.3));
            keysToDelete.forEach(key => this.messageMappings.delete(key));
            console.log(`Cleaned up ${keysToDelete.length} old message mappings`);
        }
    }

    /**
     * Send message to webhook
     * @param {Object} message - Discord message object
     * @param {string} webhookUrl - Webhook URL
     * @param {Function} resolveMentions - Function to resolve mentions
     * @param {Function} sanitizeMessage - Function to sanitize message content
     * @param {Function} sanitizeEmbeds - Function to sanitize embeds
     * @param {boolean} isUpdate - Whether this is a message update
     * @param {boolean} redactChannelName - Whether to redact the channel name
     */
    sendToWebhook(message, webhookUrl, resolveMentions, sanitizeMessage, sanitizeEmbeds, isUpdate = false, redactChannelName = false) {
        console.log(`Attempting to send to webhook for channel ${message.channel.id}`);
        
        if (!webhookUrl) {
            console.log(`No webhook URL mapped for channel ID: ${message.channel.id}`);
            return;
        }

        console.log(`Webhook URL found, queuing message for ${message.author.username}`);
        console.log(`Message author bot: ${message.author.bot}, webhookId: ${message.webhookId}, author system: ${message.author.system}`);

        // Queue the webhook request to respect rate limits
        this.webhookQueue.push(async () => {
            try {
                const displayName = message.member?.displayName || message.author.username;
                const sanitizedContent = sanitizeMessage(resolveMentions(message));
                
                // Use redacted channel name if requested
                const channelDisplay = redactChannelName ? '[redacted]' : message.channel.name;

                // Check if this is a non-user message (bot, webhook, or system)
                const isNonUser = message.author.bot || message.webhookId || message.author.system;
                console.log(`Is non-user message: ${isNonUser}`);

                const messageData = {
                    username: `${displayName} #${channelDisplay}`,
                    content: sanitizedContent,
                    // Only include avatar for actual users, not bots/applications/webhooks
                    avatar_url: isNonUser ? undefined : message.author.displayAvatarURL(),
                    embeds: message.embeds.length > 0 ? sanitizeEmbeds(message.embeds) : undefined,
                };

                // Handle Discord polls
                if (message.poll) {
                    console.log(`Processing poll data`);
                    const pollEmbed = this.createPollEmbed(message.poll, message);
                    
                    if (!messageData.embeds) {
                        messageData.embeds = [];
                    }
                    messageData.embeds.push(pollEmbed);
                }

                console.log(`Sending webhook for user: ${displayName}, content length: ${sanitizedContent.length}`);

                let form = new FormData();
                form.append('payload_json', JSON.stringify(messageData));

                // Handle attachments
                if (message.attachments.size > 0) {
                    console.log(`Processing ${message.attachments.size} attachments`);
                    const attachmentPromises = Array.from(message.attachments.values()).map(async (attachment, index) => {
                        try {
                            const response = await this.axiosInstance.get(attachment.url, { 
                                responseType: 'stream',
                                timeout: 8000
                            });
                            form.append(`file${index}`, response.data, {
                                filename: attachment.name,
                                contentType: response.headers['content-type'] || 'application/octet-stream',
                            });
                        } catch (error) {
                            console.error(`Error fetching attachment ${attachment.name}: ${error.message}`);
                        }
                    });
                    
                    await Promise.allSettled(attachmentPromises);
                }

                let response;
                if (isUpdate) {
                    // Check in-memory mapping first
                    let relayedMessageId = this.messageMappings.get(message.id);
                    
                    // If not in memory, check database
                    if (!relayedMessageId && this.databaseManager) {
                        try {
                            const dbMessage = await this.databaseManager.findMessageById(message.id);
                            if (dbMessage && dbMessage.relayed_message_id) {
                                relayedMessageId = dbMessage.relayed_message_id;
                                // Update in-memory mapping for future use
                                this.messageMappings.set(message.id, relayedMessageId);
                                console.log(`Retrieved relayed message ID from database: ${message.id} -> ${relayedMessageId}`);
                            }
                        } catch (error) {
                            console.warn(`Error checking database for relayed message ID: ${error.message}`);
                        }
                    }
                    
                    if (relayedMessageId) {
                        const url = `${webhookUrl}/messages/${relayedMessageId}`;
                        console.log(`Updating existing message via webhook: ${relayedMessageId}`);
                        response = await this.axiosInstance.patch(url, form, {
                            headers: form.getHeaders(),
                            timeout: 10000
                        });
                        
                        // Don't update database relationship on edits - it already exists
                        console.log(`Message edit webhook completed for: ${message.id} -> ${relayedMessageId}`);
                    } else {
                        console.log(`No relayed message ID found for update, skipping message edit`);
                        return;
                    }
                } else {
                    const urlWithWait = `${webhookUrl}?wait=true`;
                    console.log(`Sending new message via webhook`);
                    response = await this.axiosInstance.post(urlWithWait, form, {
                        headers: form.getHeaders(),
                        timeout: 10000
                    });

                    // Only update database relationship for new messages (not edits)
                    if (response.data?.id) {
                        this.messageMappings.set(message.id, response.data.id);
                        this.performanceStats.webhooksSent++;
                        console.log(`Webhook sent successfully, original ID: ${message.id}, relayed ID: ${response.data.id}`);
                        
                        // Update database with relayed message relationship
                        if (this.databaseManager) {
                            console.log(`Attempting to update database relationship: ${message.id} -> ${response.data.id}`);
                            this.databaseManager.updateMessageRelayedId(message.id, response.data.id)
                                .then(success => {
                                    if (success) {
                                        console.log(`Successfully updated database relationship: ${message.id} -> ${response.data.id}`);
                                    } else {
                                        console.warn(`Failed to update database relationship: ${message.id} -> ${response.data.id}`);
                                    }
                                })
                                .catch(error => console.warn(`Error updating message relationship in database:`, error.message));
                        }
                    } else {
                        console.warn(`Webhook response did not contain message ID for: ${message.id}`);
                    }
                }
            } catch (error) {
                console.error(`Error sending message to webhook: ${error.message}`);
                console.error(`Webhook URL: ${webhookUrl}`);
                this.performanceStats.errors++;
            }
        });
    }

    /**
     * Send raw data to webhook (for custom notifications)
     * @param {string} webhookUrl - Webhook URL
     * @param {Object} data - Raw webhook data
     */
    async sendRawToWebhook(webhookUrl, data) {
        if (!webhookUrl) {
            console.log('No webhook URL provided for raw webhook send');
            return;
        }

        // Queue the webhook request to respect rate limits
        this.webhookQueue.push(async () => {
            try {
                console.log(`Sending raw webhook data`);
                
                const response = await this.axiosInstance.post(webhookUrl, data, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                if (response.status === 200 || response.status === 204) {
                    this.performanceStats.webhooksSent++;
                    console.log(`Raw webhook sent successfully`);
                }
            } catch (error) {
                console.error(`Error sending raw data to webhook: ${error.message}`);
                console.error(`Webhook URL: ${webhookUrl}`);
                this.performanceStats.errors++;
            }
        });
    }

    /**
     * Check if message mapping exists
     * @param {string} messageId - Discord message ID
     * @returns {boolean}
     */
    hasMapping(messageId) {
        return this.messageMappings.has(messageId);
    }

    /**
     * Get current queue length
     * @returns {number}
     */
    getQueueLength() {
        return this.webhookQueue.length;
    }

    /**
     * Wait for queue to empty
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<void>}
     */
    waitForQueueEmpty(timeout = 3000) {
        return new Promise(resolve => {
            const checkQueue = () => {
                if (this.webhookQueue.length === 0) {
                    resolve();
                } else {
                    setTimeout(checkQueue, 100);
                }
            };
            checkQueue();
            
            // Timeout fallback
            setTimeout(resolve, timeout);
        });
    }

    /**
     * Create an embed representation of a Discord poll
     * @param {Object} poll - Discord poll object
     * @param {Object} message - Original message object
     * @returns {Object} - Poll embed
     */
    createPollEmbed(poll, message) {
        const embed = {
            title: 'Poll',
            color: 0x5865F2, // Discord blurple
            fields: []
        };

        // Add poll question
        if (poll.question?.text) {
            embed.description = poll.question.text;
        }

        return embed;
    }
}

module.exports = WebhookManager;
