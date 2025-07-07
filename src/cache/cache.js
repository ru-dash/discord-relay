class CacheManager {
    constructor() {
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
}

module.exports = CacheManager;
