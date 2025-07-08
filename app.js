require('dotenv').config();

// Memory optimization settings
if (global.gc) {
    setInterval(() => {
        global.gc();
    }, 30000); // Force garbage collection every 30 seconds
}

// Increase max listeners to prevent memory leak warnings
require('events').EventEmitter.defaultMaxListeners = 50;

// Import modules
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');

// Import custom modules
const ConfigManager = require('./src/config/config');
const DatabaseManager = require('./src/database/database');
const WebhookManager = require('./src/webhook/webhook');
const CacheManager = require('./src/cache/cache');
const PerformanceStats = require('./src/utils/performance');
const MessageHandler = require('./src/handlers/messageHandler');
const SystemEventHandler = require('./src/handlers/systemEventHandler');
const MemberManager = require('./src/handlers/memberManager');
const ShutdownManager = require('./src/utils/shutdown');
const AutoUpdater = require('./src/utils/autoUpdater');
const CommandProcessor = require('./src/handlers/commandProcessor');
const CommandCleanup = require('./cleanup-commands');

class DiscordRelayBot {
    constructor() {
        this.components = {};
        this.setupComponents();
        this.setupAxios();
    }

    /**
     * Setup all bot components
     */
    setupComponents() {
        // Initialize components
        this.components.performanceStats = new PerformanceStats();
        this.components.configManager = new ConfigManager(process.argv[2]);
        
        // Load configuration first to get database settings
        this.config = this.components.configManager.loadConfig();
        
        // Initialize hybrid database manager with configuration
        this.components.databaseManager = new DatabaseManager({
            instanceName: this.config.instanceName || this.config.botName || 'default',
            pg: this.config.database?.postgresql || {},
            redis: this.config.database?.redis || {}
        });
        this.components.webhookManager = new WebhookManager();
        this.components.cacheManager = new CacheManager();
        this.components.shutdownManager = new ShutdownManager();
        this.components.autoUpdater = new AutoUpdater();
        
        // Auto-restart is always enabled with smart error detection
        this.components.shutdownManager.configureRestart();
        
        // Initialize cache manager with performance stats
        this.components.cacheManager.initialize(this.components.performanceStats);
        
        // Create message and system event handlers
        this.components.messageHandler = new MessageHandler(
            this.components.databaseManager,
            this.components.webhookManager,
            this.components.cacheManager,
            this.components.performanceStats,
            this.components.autoUpdater,
            this.components.configManager
        );
        
        this.components.systemEventHandler = new SystemEventHandler(
            this.axiosInstance,
            this.config
        );
        
        this.components.memberManager = new MemberManager(
            this.components.databaseManager
        );

        // Initialize command processor
        this.components.commandProcessor = new CommandProcessor(
            null, // client will be set later
            this.components.configManager,
            this.config.instanceName || 'default',
            this.components.databaseManager
        );
    }

    /**
     * Setup axios instance with optimized connection pooling
     */
    setupAxios() {
        this.axiosInstance = axios.create({
            timeout: 15000,
            maxRedirects: 3,
            httpAgent: new (require('http')).Agent({
                keepAlive: true,
                maxSockets: 25,
                maxFreeSockets: 5,
                timeout: 30000,
                freeSocketTimeout: 15000
            }),
            httpsAgent: new (require('https')).Agent({
                keepAlive: true,
                maxSockets: 25,
                maxFreeSockets: 5,
                timeout: 30000,
                freeSocketTimeout: 15000
            })
        });
    }

    /**
     * Setup Discord client
     */
    setupClient() {
        this.components.client = new Client({
            checkUpdate: false,
            ws: { 
                properties: { 
                    browser: "Discord Client", 
                    os: "Windows", 
                    device: "desktop" 
                }
            }
        });

        // Set client reference in command processor
        this.components.commandProcessor.client = this.components.client;

        this.setupEventListeners();
    }

    /**
     * Setup Discord event listeners
     */
    setupEventListeners() {
        const client = this.components.client;
        const messageHandler = this.components.messageHandler;
        const systemEventHandler = this.components.systemEventHandler;

        // Message events
        client.on('messageCreate', (message) => {
            // Handle debug command first
            if (messageHandler.handleDebugCommand(message, client)) {
                return;
            }
            
            // Handle regular message
            messageHandler.handleMessageCreate(message);
        });

        client.on('messageUpdate', (oldMessage, newMessage) => {
            messageHandler.handleMessageUpdate(oldMessage, newMessage);
        });

        // System events
        client.on('guildMemberUpdate', (oldMember, newMember) => {
            systemEventHandler.handleGuildMemberUpdate(oldMember, newMember, client);
        });

        client.on('guildCreate', (guild) => {
            systemEventHandler.handleGuildCreate(guild);
        });

        client.on('guildDelete', (guild) => {
            systemEventHandler.handleGuildDelete(guild);
        });

        client.on('channelUpdate', async (oldChannel, newChannel) => {
            await systemEventHandler.handleChannelUpdate(
                oldChannel, 
                newChannel, 
                (guildId) => this.components.cacheManager.isRelayedGuild(guildId)
            );
        });

        // Scheduled event handlers
        client.on("guildScheduledEventCreate", (guildEvent) => {
            systemEventHandler.handleGuildScheduledEventCreate(
                guildEvent,
                (guildId) => this.components.cacheManager.isRelayedGuild(guildId)
            );
        });

        client.on("guildScheduledEventDelete", (guildEvent) => {
            systemEventHandler.handleGuildScheduledEventDelete(
                guildEvent,
                (guildId) => this.components.cacheManager.isRelayedGuild(guildId)
            );
        });

        client.on("guildScheduledEventUpdate", (oldGuildEvent, newGuildEvent) => {
            systemEventHandler.handleGuildScheduledEventUpdate(
                oldGuildEvent,
                newGuildEvent,
                (guildId) => this.components.cacheManager.isRelayedGuild(guildId)
            );
        });

        // Ready event
        client.once('ready', () => {
            const instanceName = this.config.instanceName || 'default';
            const agentName = this.config.agentName || 'Discord Relay Bot';
            console.log(`[${instanceName}] ${agentName} logged in as ${client.user.tag}!`);
            
            // Start command processor
            this.components.commandProcessor.start();
            
            setTimeout(() => {
                this.initializeAfterReady();
            }, 2000); // 2 second delay
        });
    }

    /**
     * Initialize components after client is ready
     */
    initializeAfterReady() {
        const channelWebhookMap = this.components.configManager.getChannelMappings();
        
        // Set channel mappings in message handler
        this.components.messageHandler.setChannelMappings(channelWebhookMap);
        
        // Populate relayed guild IDs cache
        this.components.memberManager.populateRelayedGuildIds(
            this.components.client,
            channelWebhookMap,
            this.components.cacheManager
        );

        // Fetch members for all relayed channels
        this.config.channelMappings.forEach(mapping => {
            this.components.memberManager.fetchAndSaveChannelMembers(
                mapping.channelId,
                this.components.client
            );
        });
        
        console.log(`[${this.config.instanceName || 'default'}] Bot initialization completed - ready to relay messages`);
        
        // Cleanup old command files on startup
        this.cleanupOldCommands();
        
        // Start periodic update checks
        this.components.autoUpdater.startPeriodicChecks();
        
        // Set up periodic command cleanup (every 6 hours)
        setInterval(() => {
            this.cleanupOldCommands();
        }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds
        
        // Start periodic member synchronization (every 4 hours)
        this.startPeriodicMemberSync();
    }

    /**
     * Cleanup old command files
     */
    async cleanupOldCommands() {
        try {
            const cleanup = new CommandCleanup('./commands');
            console.log(`[${this.config.instanceName || 'default'}] Cleaning up old command files...`);
            
            const results = await cleanup.cleanup(false); // false = not a dry run
            
            if (results.deleted.length > 0) {
                console.log(`[${this.config.instanceName || 'default'}] Cleaned up ${results.deleted.length} old command files`);
            } else {
                console.log(`[${this.config.instanceName || 'default'}] No old command files to clean up`);
            }
            
            if (results.errors.length > 0) {
                console.warn(`[${this.config.instanceName || 'default'}] Cleanup errors:`, results.errors);
            }
        } catch (error) {
            console.error(`[${this.config.instanceName || 'default'}] Error during command cleanup:`, error.message);
        }
    }

    /**
     * Start periodic member synchronization
     */
    startPeriodicMemberSync() {
        const syncIntervalHours = 4; // Sync every 4 hours
        const syncIntervalMs = syncIntervalHours * 60 * 60 * 1000;
        
        console.log(`[${this.config.instanceName || 'default'}] Starting periodic member sync (every ${syncIntervalHours} hours)`);
        
        this.memberSyncInterval = setInterval(async () => {
            try {
                console.log(`[${this.config.instanceName || 'default'}] Starting scheduled member synchronization...`);
                
                let totalSynced = 0;
                
                // Sync members for each configured channel
                for (const mapping of this.config.channelMappings) {
                    try {
                        const channel = this.components.client.channels.cache.get(mapping.channelId);
                        if (channel) {
                            console.log(`[${this.config.instanceName || 'default'}] Syncing members for channel: ${channel.name}`);
                            
                            await this.components.memberManager.fetchAndSaveChannelMembers(
                                mapping.channelId,
                                this.components.client,
                                true // isPeriodicSync = true
                            );
                            
                            totalSynced++;
                            
                            // Add a small delay between channels to avoid rate limits
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } else {
                            console.warn(`[${this.config.instanceName || 'default'}] Channel ${mapping.channelId} not found during member sync`);
                        }
                    } catch (error) {
                        console.error(`[${this.config.instanceName || 'default'}] Error syncing members for channel ${mapping.channelId}:`, error.message);
                    }
                }
                
                console.log(`[${this.config.instanceName || 'default'}] Member synchronization completed - synced ${totalSynced} channels`);
                
                // Update performance stats if available
                if (this.components.performanceStats) {
                    this.components.performanceStats.memberSyncs = (this.components.performanceStats.memberSyncs || 0) + 1;
                    this.components.performanceStats.lastMemberSync = Date.now();
                }
                
            } catch (error) {
                console.error(`[${this.config.instanceName || 'default'}] Error during periodic member sync:`, error.message);
            }
        }, syncIntervalMs);
        
        // Store interval ID for cleanup
        this.components.memberSyncInterval = this.memberSyncInterval;
    }

    /**
     * Start the bot
     */
    async start() {
        try {
            // Initialize database with cache manager
            await this.components.databaseManager.initialize(
                this.components.performanceStats,
                this.components.cacheManager
            );
            
            // Initialize webhook manager
            this.components.webhookManager.initialize(
                this.axiosInstance, 
                this.components.performanceStats,
                this.components.databaseManager
            );
            
            // Setup Discord client
            this.setupClient();
            
            // Setup config watching and change handling
            this.setupConfigWatching();
            
            // Register components for graceful shutdown
            this.components.shutdownManager.registerComponents(this.components, this.config);
            
            // Start the Discord client
            console.log('Attempting to log in...');
            await this.components.client.login(this.config.token);
            console.log('Bot logged in successfully');
            
        } catch (error) {
            console.error(`Failed to start bot: ${error.message}`);
            
            // Check if this is a token-related error and handle appropriately
            if (this.components?.shutdownManager) {
                await this.components.shutdownManager.handleCrash('startup-failure', error);
            } else {
                process.exit(1);
            }
        }
    }

    /**
     * Setup config file watching and change handling
     */
    setupConfigWatching() {
        // Start watching config files
        this.components.configManager.startWatching();
        
        // Handle config changes
        this.components.configManager.on('configChanged', (event) => {
            this.handleConfigChange(event);
        });
    }

    /**
     * Handle configuration changes
     */
    handleConfigChange(event) {
        const { oldConfig, newConfig, changes } = event;
        
        console.log('Configuration changed, updating components...');
        
        // Check if there are any changes at all
        if (Object.keys(changes).length === 0) {
            console.log('No actual changes detected in config');
            return;
        }
        
        // Update the main config reference
        this.config = newConfig;
        
        // Check for critical changes that require restart
        if (changes.token) {
            console.warn('Token changed! This requires a bot restart to take effect.');
            console.warn('The bot will continue with the old token until manually restarted.');
        }
        
        // Update channel mappings if they changed
        if (changes.channelMappings) {
            const channelWebhookMap = this.components.configManager.getChannelMappings();
            this.components.messageHandler.setChannelMappings(channelWebhookMap);
            
            // Re-populate relayed guild IDs cache
            this.components.cacheManager.updateRelayedGuilds(
                this.components.client,
                channelWebhookMap
            );
            
            // Fetch members for new channels
            newConfig.channelMappings.forEach(mapping => {
                if (mapping.channelId) {
                    this.components.memberManager.fetchAndSaveChannelMembers(
                        mapping.channelId,
                        this.components.client
                    );
                }
            });
            
            console.log('Channel mappings updated');
        }
        
        // Update webhook URLs if eventHook changed
        if (changes.eventHook) {
            console.log('Event hook URL updated');
        }
        
        // Update database settings if they changed
        if (changes.database) {
            console.log('Database settings updated (requires restart for full effect)');
        }
        
        // Update system hook if it changed
        if (changes.systemHook) {
            console.log('System hook URL updated');
        }
        
        // Update everyoneCatch settings if they changed
        if (changes.everyoneCatch) {
            console.log('Everyone catch settings updated');
        }
        
        // Update bot name/agent name if they changed
        if (changes.botName || changes.agentName) {
            console.log('Bot/agent name updated');
        }
        
        console.log('Configuration update complete');
    }
}

// Start the bot
const bot = new DiscordRelayBot();
bot.start().catch(async error => {
    console.error('Fatal error:', error);
    
    // Try to use shutdown manager if available for proper error handling
    if (bot.components?.shutdownManager) {
        await bot.components.shutdownManager.handleCrash('fatal-startup-error', error);
    } else {
        process.exit(1);
    }
});
