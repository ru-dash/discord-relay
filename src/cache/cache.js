const MemoryCache = require('./memoryCache');

class CacheManager {
    constructor() {
        // Initialize memory cache with 50MB limit
        this.memoryCache = new MemoryCache({
            maxMemoryMB: 50,     // 50MB RAM limit
            maxItems: 10000,     // Max 10,000 items
            defaultTTL: 3600,    // 1 hour default
            cleanupInterval: 300000 // 5 minutes cleanup
        });
        
        // Mention cache for resolved mentions
        this.mentionCache = new Map();
        this.MENTION_CACHE_SIZE = 500;
        
        // Content hash cache for duplicate detection
        this.contentHashCache = new Map();
        this.CONTENT_HASH_CACHE_SIZE = 1000;
        
        // Guild cache for fast lookups
        this.relayedGuildIds = new Set();
        
        // Performance stats reference
        this.performanceStats = null;
        
        // Cache TTL settings (seconds)
        this.CACHE_TTL = {
            messages: 3600,      // 1 hour for recent messages
            members: 7200,       // 2 hours for member data
            guilds: 86400,       // 24 hours for guild info
            channels: 43200      // 12 hours for channel info
        };
    }

    /**
     * Initialize cache manager
     * @param {Object} performanceStats - Performance statistics object
     */
    initialize(performanceStats) {
        this.performanceStats = performanceStats;
    }

    /**
     * Cache resolved mention content
     * @param {string} key - Cache key
     * @param {string} content - Resolved content
     */
    cacheMention(key, content) {
        // Implement LRU cache
        if (this.mentionCache.size >= this.MENTION_CACHE_SIZE) {
            const firstKey = this.mentionCache.keys().next().value;
            this.mentionCache.delete(firstKey);
        }
        
        this.mentionCache.set(key, content);
    }

    /**
     * Get cached mention content
     * @param {string} key - Cache key
     * @returns {string|null} - Cached content or null
     */
    getCachedMention(key) {
        if (this.mentionCache.has(key)) {
            // Move to end (LRU) and update stats
            const value = this.mentionCache.get(key);
            this.mentionCache.delete(key);
            this.mentionCache.set(key, value);
            if (this.performanceStats) {
                this.performanceStats.cacheHits++;
            }
            return value;
        }

        // Cache miss - update stats
        if (this.performanceStats) {
            this.performanceStats.cacheMisses++;
        }
        return null;
    }

    /**
     * Generate content hash for duplicate detection
     * @param {string} content - Message content
     * @returns {number} - Hash value
     */
    getContentHash(content) {
        let hash = 0;
        if (content.length === 0) return hash;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    /**
     * Check if content is duplicate
     * @param {Object} message - Discord message object
     * @returns {boolean} - True if duplicate
     */
    isDuplicateContent(message) {
        const contentHash = this.getContentHash(message.content || '');
        const key = `${message.author.id}-${contentHash}`;
        const now = Date.now();
        
        if (this.contentHashCache.has(key)) {
            const lastTime = this.contentHashCache.get(key);
            if (now - lastTime < 5000) { // 5 second duplicate window
                return true;
            }
        }
        
        // Implement LRU cache
        if (this.contentHashCache.size >= this.CONTENT_HASH_CACHE_SIZE) {
            const firstKey = this.contentHashCache.keys().next().value;
            this.contentHashCache.delete(firstKey);
        }
        
        this.contentHashCache.set(key, now);
        return false;
    }

    /**
     * Add guild ID to relayed guilds cache
     * @param {string} guildId - Guild ID
     */
    addRelayedGuild(guildId) {
        this.relayedGuildIds.add(guildId);
    }

    /**
     * Check if guild is being relayed
     * @param {string} guildId - Guild ID
     * @returns {boolean} - True if guild is relayed
     */
    isRelayedGuild(guildId) {
        return this.relayedGuildIds.has(guildId);
    }

    /**
     * Clear relayed guilds cache
     */
    clearRelayedGuilds() {
        this.relayedGuildIds.clear();
    }

    /**
     * Update relayed guilds cache with new channel mappings
     * @param {Object} client - Discord client
     * @param {Map} channelWebhookMap - Channel ID to webhook URL mappings
     */
    updateRelayedGuilds(client, channelWebhookMap) {
        this.clearRelayedGuilds();
        
        // Add guild IDs based on channel mappings
        for (const channelId of channelWebhookMap.keys()) {
            const channel = client.channels.cache.get(channelId);
            if (channel && channel.guild) {
                this.addRelayedGuild(channel.guild.id);
            }
        }
        
        console.log(`Updated relayed guilds cache with ${this.relayedGuildIds.size} guilds`);
    }

    /**
     * Get cache sizes for monitoring
     * @returns {Object} - Cache sizes
     */
    getCacheSizes() {
        return {
            mention: this.mentionCache.size,
            content: this.contentHashCache.size,
            relayedGuilds: this.relayedGuildIds.size
        };
    }

    /**
     * Clear all caches
     */
    clearAll() {
        this.mentionCache.clear();
        this.contentHashCache.clear();
        this.relayedGuildIds.clear();
    }

    /**
     * Generate cache key for memory cache
     * @param {string} type - Type of data (message, member, etc.)
     * @param {string} identifier - Unique identifier
     * @returns {string} - Cache key
     */
    getCacheKey(type, identifier) {
        return MemoryCache.getCacheKey(this.instanceName || 'default', type, identifier);
    }

    /**
     * Get data from memory cache with fallback
     * @param {string} cacheKey - Cache key
     * @param {Function} fallbackQuery - Function that returns fresh data
     * @param {number} ttl - Cache TTL in seconds
     * @returns {Promise<any>} - Cached or fresh data
     */
    async getWithCache(cacheKey, fallbackQuery, ttl = 3600) {
        // Try memory cache first
        const cached = this.memoryCache.get(cacheKey);
        if (cached !== undefined) {
            if (this.performanceStats) {
                this.performanceStats.cacheHits++;
            }
            return cached;
        }

        // Fallback to fresh data
        const data = await fallbackQuery();
        
        // Cache the result
        if (data !== undefined && data !== null) {
            this.memoryCache.set(cacheKey, data, ttl);
        }

        if (this.performanceStats) {
            this.performanceStats.cacheMisses++;
        }
        return data;
    }

    /**
     * Cache message data
     * @param {Object} messageData - Message data
     */
    cacheMessage(messageData) {
        const cacheKey = this.getCacheKey('message', messageData.id);
        this.memoryCache.set(cacheKey, messageData, this.CACHE_TTL.messages);
        
        // Also maintain a channel recent messages list
        const channelKey = this.getCacheKey('channel_messages', messageData.channelId);
        let recentMessages = this.memoryCache.get(channelKey) || [];
        
        // Add new message to front, keep last 100
        recentMessages.unshift(messageData.id);
        if (recentMessages.length > 100) {
            recentMessages = recentMessages.slice(0, 100);
        }
        
        this.memoryCache.set(channelKey, recentMessages, this.CACHE_TTL.messages);
    }

    /**
     * Cache member data
     * @param {Object} memberData - Member data
     */
    cacheMember(memberData) {
        const cacheKey = this.getCacheKey('member', memberData.userId);
        this.memoryCache.set(cacheKey, memberData, this.CACHE_TTL.members);
        
        // Update guild members set
        const guildKey = this.getCacheKey('guild_members', memberData.guildId);
        let guildMembers = this.memoryCache.get(guildKey) || new Set();
        
        if (!(guildMembers instanceof Set)) {
            guildMembers = new Set(guildMembers);
        }
        
        guildMembers.add(memberData.userId);
        this.memoryCache.set(guildKey, Array.from(guildMembers), this.CACHE_TTL.members);
    }

    /**
     * Get cached member data
     * @param {string} userId - User ID
     * @returns {Object|undefined} - Member data
     */
    getCachedMember(userId) {
        const cacheKey = this.getCacheKey('member', userId);
        return this.memoryCache.get(cacheKey);
    }

    /**
     * Get cached message data
     * @param {string} messageId - Message ID
     * @returns {Object|undefined} - Message data
     */
    getCachedMessage(messageId) {
        const cacheKey = this.getCacheKey('message', messageId);
        return this.memoryCache.get(cacheKey);
    }

    /**
     * Get recent messages for a channel
     * @param {string} channelId - Channel ID
     * @returns {Array} - Array of message IDs
     */
    getRecentMessages(channelId) {
        const channelKey = this.getCacheKey('channel_messages', channelId);
        return this.memoryCache.get(channelKey) || [];
    }

    /**
     * Get memory cache statistics
     * @returns {Object} - Cache statistics
     */
    getCacheStats() {
        return this.memoryCache.getStats();
    }

    /**
     * Set instance name for cache keys
     * @param {string} instanceName - Instance name
     */
    setInstanceName(instanceName) {
        this.instanceName = instanceName;
    }

    /**
     * Shutdown cache manager
     */
    shutdown() {
        console.log(`[CacheManager] Shutting down cache...`);
        this.memoryCache.shutdown();
        this.mentionCache.clear();
        this.contentHashCache.clear();
        this.relayedGuildIds.clear();
    }
}

module.exports = CacheManager;
