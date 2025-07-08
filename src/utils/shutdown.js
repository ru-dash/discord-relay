class ShutdownManager {
    constructor() {
        this.isShuttingDown = false;
        this.components = [];
        this.restartEnabled = true;
        this.maxRestarts = 5;
        this.restartCount = 0;
        this.restartCooldown = 30000; // 30 seconds between restarts
        this.lastRestartTime = 0;
        this.config = null; // Will be set by registerComponents
        
        // Errors that should NOT trigger restart
        this.nonRestartableErrors = [
            'invalid token',
            'unauthorized',
            'token was revoked',
            'missing permissions',
            'invalid client secret',
            'token has expired'
        ];
    }

    /**
     * Configure auto-restart settings (always enabled, just sets limits)
     */
    configureRestart() {
        console.log(`[ShutdownManager] Auto-restart enabled with smart error detection`);
        console.log(`[ShutdownManager] Max restarts: ${this.maxRestarts}, Cooldown: ${this.restartCooldown}ms`);
    }

    /**
     * Register components for graceful shutdown
     * @param {Object} components - Object containing all components to shutdown
     * @param {Object} config - Bot configuration for system notifications
     */
    registerComponents(components, config = null) {
        this.components = components;
        this.config = config;
        
        // Register signal handlers (these should NOT restart)
        process.on('SIGINT', () => {
            console.log('Received SIGINT - performing graceful shutdown (no restart)');
            this.restartEnabled = false;
            this.gracefulShutdown('SIGINT');
        });
        
        process.on('SIGTERM', () => {
            console.log('Received SIGTERM - performing graceful shutdown (no restart)');
            this.restartEnabled = false;
            this.gracefulShutdown('SIGTERM');
        });

        // Handle uncaught exceptions (these SHOULD restart)
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            this.handleCrash('uncaughtException', error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            this.handleCrash('unhandledRejection', reason);
        });
    }

    /**
     * Check if an error should prevent restart
     * @param {Error|string} error - Error object or message
     * @returns {boolean} - True if error is non-restartable
     */
    isNonRestartableError(error) {
        const errorMessage = (error?.message || error?.toString() || '').toLowerCase();
        
        return this.nonRestartableErrors.some(pattern => 
            errorMessage.includes(pattern.toLowerCase())
        );
    }

    /**
     * Handle application crashes with restart logic
     * @param {string} reason - Crash reason
     * @param {Error} error - Error object
     */
    async handleCrash(reason, error) {
        if (this.isShuttingDown) {
            return; // Already handling shutdown
        }

        console.error(`[ShutdownManager] Application crash detected: ${reason}`);
        console.error('Error details:', error);

        // Check if this is a non-restartable error
        if (this.isNonRestartableError(error)) {
            console.error(`[ShutdownManager] Non-restartable error detected (${error?.message || error}). Stopping auto-restart.`);
            console.error(`[ShutdownManager] Please fix the issue and restart manually.`);
            await this.sendSystemNotification('Non-Restartable Error', error, 'Stopping auto-restart');
            await this.gracefulShutdown(reason);
            return;
        }

        // Check restart limits
        if (this.restartCount >= this.maxRestarts) {
            console.error(`[ShutdownManager] Maximum restart attempts (${this.maxRestarts}) reached. Performing final shutdown.`);
            await this.gracefulShutdown(reason);
            return;
        }

        // Check cooldown period
        const now = Date.now();
        const timeSinceLastRestart = now - this.lastRestartTime;
        if (timeSinceLastRestart < this.restartCooldown) {
            const remaining = this.restartCooldown - timeSinceLastRestart;
            console.log(`[ShutdownManager] Restart cooldown active, waiting ${remaining}ms...`);
            setTimeout(() => this.handleCrash(reason, error), remaining);
            return;
        }

        // Attempt restart
        this.restartCount++;
        this.lastRestartTime = now;
        console.log(`[ShutdownManager] Attempting restart ${this.restartCount}/${this.maxRestarts}...`);

        try {
            await this.performRestart(reason);
        } catch (restartError) {
            console.error('[ShutdownManager] Restart failed:', restartError);
            await this.gracefulShutdown(`restart-failed-${reason}`);
        }
    }

    /**
     * Perform application restart
     * @param {string} reason - Restart reason
     */
    async performRestart(reason) {
        console.log(`[ShutdownManager] Starting restart process due to: ${reason}`);
        
        try {
            // Clean shutdown of current components
            await this.cleanupComponents();
            
            console.log(`[ShutdownManager] Components cleaned up, exiting with restart code...`);
            
            // Exit with special code to indicate restart needed
            // External process manager should detect this and restart
            process.exit(2); // Exit code 2 = restart requested
            
        } catch (error) {
            console.error('[ShutdownManager] Error during restart cleanup:', error);
            process.exit(1); // Exit with error code
        }
    }

    /**
     * Clean up components without exiting process
     * @returns {Promise<void>}
     */
    async cleanupComponents() {
        console.log('[ShutdownManager] Cleaning up components...');
        
        try {
            // Clear all intervals
            if (this.components.webhookManager) {
                // Webhook manager handles its own intervals internally
            }
            
            // Clear message handler debounce timers
            if (this.components.messageHandler) {
                this.components.messageHandler.clearDebounceTimers();
            }

            // Stop command processor
            if (this.components.commandProcessor) {
                this.components.commandProcessor.stop();
            }
            
            // Clear member sync interval
            if (this.components.memberSyncInterval) {
                clearInterval(this.components.memberSyncInterval);
                console.log('Member sync interval cleared');
            }
            
            // Flush any pending database batches with timeout
            if (this.components.databaseManager) {
                const flushPromise = Promise.race([
                    this.components.databaseManager.flushMessageBatch(),
                    new Promise(resolve => setTimeout(resolve, 3000)) // 3 second timeout for restart
                ]);
                await flushPromise;
            }
            
            // Wait for webhook queue to process with timeout
            if (this.components.webhookManager) {
                await this.components.webhookManager.waitForQueueEmpty(2000);
            }
            
            // Close database connection
            if (this.components.databaseManager) {
                await this.components.databaseManager.close();
            }
            
            // Close cache manager
            if (this.components.cacheManager) {
                this.components.cacheManager.shutdown();
            }
            
            // Destroy Discord client
            if (this.components.client) {
                this.components.client.destroy();
            }
            
            console.log('[ShutdownManager] Component cleanup completed');
            
        } catch (error) {
            console.error('[ShutdownManager] Error during component cleanup:', error.message);
            throw error;
        }
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
            await this.cleanupComponents();
            
            console.log('Graceful shutdown completed.');
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error.message);
            process.exit(1);
        }
    }

    /**
     * Send critical error notification to system webhook
     * @param {string} errorType - Type of error (e.g., 'Invalid Token')
     * @param {Error|string} error - Error object or message
     * @param {string} action - Action being taken (e.g., 'Stopping auto-restart')
     */
    async sendSystemNotification(errorType, error, action) {
        if (!this.config?.systemHook) {
            console.log('[ShutdownManager] No system webhook configured, skipping notification');
            return;
        }

        try {
            const axios = require('axios');
            const instanceName = this.config.instanceName || 'unknown';
            const agentName = this.config.agentName || 'Discord Relay Bot';
            
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            
            const embed = {
                title: `Critical Error - ${errorType}`,
                color: 0xFF0000, // Red color
                fields: [
                    {
                        name: 'Instance',
                        value: `${agentName} (${instanceName})`,
                        inline: true
                    },
                    {
                        name: 'Error Type',
                        value: errorType,
                        inline: true
                    },
                    {
                        name: 'Action Taken',
                        value: action,
                        inline: true
                    },
                    {
                        name: 'Error Details',
                        value: `\`\`\`${errorMessage.substring(0, 1000)}\`\`\``,
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Auto Restart Disabled. Config must be updated to fix this error',
                }
            };

            const payload = {
                embeds: [embed]
            };

            await axios.post(this.config.systemHook, payload, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[ShutdownManager] System notification sent successfully for ${errorType}`);

        } catch (notificationError) {
            console.error('[ShutdownManager] Failed to send system notification:', notificationError.message);
            // Don't throw here - we don't want notification failures to prevent shutdown
        }
    }
}

module.exports = ShutdownManager;
