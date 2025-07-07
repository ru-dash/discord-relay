class ShutdownManager {
    constructor() {
        this.isShuttingDown = false;
        this.components = [];
    }

    /**
     * Register components for graceful shutdown
     * @param {Object} components - Object containing all components to shutdown
     */
    registerComponents(components) {
        this.components = components;
        
        // Register signal handlers
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            this.gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.gracefulShutdown('unhandledRejection');
        });
    }

    /**
     * Perform graceful shutdown
     * @param {string} signal - Signal that triggered shutdown
     */
    async gracefulShutdown(signal) {
        if (this.isShuttingDown) {
            console.log('Shutdown already in progress...');
            return;
        }
        
        this.isShuttingDown = true;
        console.log(`Received ${signal}. Shutting down gracefully...`);
        
        try {
            // Clear all intervals
            if (this.components.webhookManager) {
                // Webhook manager handles its own intervals internally
            }
            
            // Clear message handler debounce timers
            if (this.components.messageHandler) {
                this.components.messageHandler.clearDebounceTimers();
            }
            
            // Flush any pending database batches with timeout
            if (this.components.databaseManager) {
                const flushPromise = Promise.race([
                    this.components.databaseManager.flushMessageBatch(),
                    new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
                ]);
                await flushPromise;
            }
            
            // Wait for webhook queue to process with timeout
            if (this.components.webhookManager) {
                await this.components.webhookManager.waitForQueueEmpty(3000);
            }
            
            // Close database connection
            if (this.components.databaseManager) {
                await this.components.databaseManager.close();
            }
            
            // Destroy Discord client
            if (this.components.client) {
                this.components.client.destroy();
            }
            
            console.log('Graceful shutdown completed.');
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error.message);
            process.exit(1);
        }
    }
}

module.exports = ShutdownManager;
