class MemoryCache {
    constructor(options = {}) {
        this.cache = new Map();
        this.timers = new Map();
        this.accessTimes = new Map(); // For LRU eviction
        
        // Configuration with defaults
        this.maxMemoryMB = options.maxMemoryMB || 50; // 50MB default
        this.maxItems = options.maxItems || 10000; // Max number of items
        this.defaultTTL = options.defaultTTL || 3600; // 1 hour default
        this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes
        
        // Statistics
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            memoryUsage: 0,
            itemCount: 0
        };
        
        // Start periodic cleanup
        this.startCleanup();
        
        console.log(`[MemoryCache] Initialized with ${this.maxMemoryMB}MB limit, max ${this.maxItems} items`);
    }

    /**
     * Set a value in cache with optional TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds
     */
    set(key, value, ttl = this.defaultTTL) {
        // Remove existing entry if it exists
        this.delete(key);
        
        // Check memory limits before adding
        const serializedValue = JSON.stringify(value);
        const itemSize = this.calculateSize(key, serializedValue);
        
        if (!this.canFitItem(itemSize)) {
            this.evictItems(itemSize);
        }
        
        // Store the item
        const cacheItem = {
            value: value,
            size: itemSize,
            createdAt: Date.now(),
            expiresAt: Date.now() + (ttl * 1000)
        };
        
        this.cache.set(key, cacheItem);
        this.accessTimes.set(key, Date.now());
        
        // Set expiration timer
        if (ttl > 0) {
            const timer = setTimeout(() => {
                this.delete(key);
            }, ttl * 1000);
            this.timers.set(key, timer);
        }
        
        this.updateStats();
    }

    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {any} - Cached value or undefined
     */
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            this.stats.misses++;
            return undefined;
        }
        
        // Check if expired
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this.delete(key);
            this.stats.misses++;
            return undefined;
        }
        
        // Update access time for LRU
        this.accessTimes.set(key, Date.now());
        this.stats.hits++;
        
        return item.value;
    }

    /**
     * Check if key exists in cache
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(key) {
        return this.get(key) !== undefined;
    }

    /**
     * Delete a key from cache
     * @param {string} key - Cache key
     */
    delete(key) {
        const item = this.cache.get(key);
        if (item) {
            this.cache.delete(key);
            this.accessTimes.delete(key);
            
            // Clear timer
            const timer = this.timers.get(key);
            if (timer) {
                clearTimeout(timer);
                this.timers.delete(key);
            }
            
            this.updateStats();
            return true;
        }
        return false;
    }

    /**
     * Clear all cache entries
     */
    clear() {
        // Clear all timers
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        
        this.cache.clear();
        this.timers.clear();
        this.accessTimes.clear();
        this.updateStats();
        
        console.log(`[MemoryCache] Cache cleared`);
    }

    /**
     * Calculate approximate size of a cache item in bytes
     * @param {string} key - Cache key
     * @param {string} serializedValue - JSON serialized value
     * @returns {number} - Size in bytes
     */
    calculateSize(key, serializedValue) {
        // Rough calculation: key + value + overhead
        const keySize = Buffer.byteLength(key, 'utf8');
        const valueSize = Buffer.byteLength(serializedValue, 'utf8');
        const overhead = 100; // Approximate overhead for Map entry, timers, etc.
        
        return keySize + valueSize + overhead;
    }

    /**
     * Check if an item can fit in cache
     * @param {number} itemSize - Size of item in bytes
     * @returns {boolean}
     */
    canFitItem(itemSize) {
        const maxBytes = this.maxMemoryMB * 1024 * 1024;
        return (this.stats.memoryUsage + itemSize) <= maxBytes && 
               this.stats.itemCount < this.maxItems;
    }

    /**
     * Evict items to make room for new item
     * @param {number} requiredSize - Size needed in bytes
     */
    evictItems(requiredSize) {
        const maxBytes = this.maxMemoryMB * 1024 * 1024;
        const targetSize = maxBytes * 0.8; // Target 80% of max after eviction
        
        // Sort by access time (LRU first)
        const entries = Array.from(this.accessTimes.entries())
            .sort((a, b) => a[1] - b[1]); // Oldest first
        
        let evictedCount = 0;
        let evictedSize = 0;
        
        for (const [key] of entries) {
            if (this.stats.memoryUsage <= targetSize && 
                this.stats.itemCount < this.maxItems) {
                break;
            }
            
            const item = this.cache.get(key);
            if (item) {
                evictedSize += item.size;
                this.delete(key);
                evictedCount++;
            }
        }
        
        this.stats.evictions += evictedCount;
        
        if (evictedCount > 0) {
            console.log(`[MemoryCache] Evicted ${evictedCount} items (${Math.round(evictedSize / 1024)}KB) to free memory`);
        }
    }

    /**
     * Update cache statistics
     */
    updateStats() {
        let totalSize = 0;
        
        for (const item of this.cache.values()) {
            totalSize += item.size;
        }
        
        this.stats.memoryUsage = totalSize;
        this.stats.itemCount = this.cache.size;
    }

    /**
     * Get cache statistics
     * @returns {Object} - Cache statistics
     */
    getStats() {
        this.updateStats();
        
        return {
            ...this.stats,
            memoryUsageMB: Math.round((this.stats.memoryUsage / 1024 / 1024) * 100) / 100,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            maxMemoryMB: this.maxMemoryMB,
            maxItems: this.maxItems
        };
    }

    /**
     * Start periodic cleanup of expired items
     */
    startCleanup() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired();
        }, this.cleanupInterval);
    }

    /**
     * Clean up expired items
     */
    cleanupExpired() {
        const now = Date.now();
        const expiredKeys = [];
        
        for (const [key, item] of this.cache.entries()) {
            if (item.expiresAt && now > item.expiresAt) {
                expiredKeys.push(key);
            }
        }
        
        for (const key of expiredKeys) {
            this.delete(key);
        }
        
        if (expiredKeys.length > 0) {
            console.log(`[MemoryCache] Cleaned up ${expiredKeys.length} expired items`);
        }
    }

    /**
     * Shutdown the cache
     */
    shutdown() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        this.clear();
        console.log(`[MemoryCache] Cache shutdown complete`);
    }

    /**
     * Get cache key with instance prefix
     * @param {string} instanceName - Instance name
     * @param {string} type - Data type
     * @param {string} identifier - Unique identifier
     * @returns {string} - Cache key
     */
    static getCacheKey(instanceName, type, identifier) {
        return `${instanceName}:${type}:${identifier}`;
    }
}

module.exports = MemoryCache;
