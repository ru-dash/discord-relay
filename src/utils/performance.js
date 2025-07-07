class PerformanceStats {
    constructor() {
        this.messagesProcessed = 0;
        this.webhooksSent = 0;
        this.dbOperations = 0;
        this.errors = 0;
        this.duplicatesSkipped = 0;
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.startTime = Date.now();
        this.lastResetTime = Date.now();
    }

    /**
     * Reset performance counters
     */
    reset() {
        this.lastResetTime = Date.now();
    }

    /**
     * Get uptime in minutes
     * @returns {number} - Uptime in minutes
     */
    getUptime() {
        return (Date.now() - this.startTime) / 1000 / 60;
    }

    /**
     * Get period time in minutes
     * @returns {number} - Period time in minutes
     */
    getPeriodTime() {
        return (Date.now() - this.lastResetTime) / 1000 / 60;
    }

    /**
     * Get cache hit rate percentage
     * @returns {number} - Cache hit rate percentage
     */
    getCacheHitRate() {
        const total = this.cacheHits + this.cacheMisses;
        return total > 0 ? (this.cacheHits / total * 100) : 0;
    }

    /**
     * Get performance summary object
     * @returns {Object} - Performance summary
     */
    getSummary() {
        const periodTime = Math.max(this.getPeriodTime(), 0.1);
        
        return {
            uptime: this.getUptime(),
            messagesPerMin: this.messagesProcessed / periodTime,
            webhooksPerMin: this.webhooksSent / periodTime,
            dbOpsPerMin: this.dbOperations / periodTime,
            errorsPerMin: this.errors / periodTime,
            duplicatesSkipped: this.duplicatesSkipped,
            cacheHitRate: this.getCacheHitRate(),
            totalMessages: this.messagesProcessed,
            totalWebhooks: this.webhooksSent,
            totalDbOps: this.dbOperations,
            totalErrors: this.errors
        };
    }
}

module.exports = PerformanceStats;
