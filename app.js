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
        this.components.databaseManager = new DatabaseManager();
        this.components.webhookManager = new WebhookManager();
        this.components.cacheManager = new CacheManager();
        this.components.shutdownManager = new ShutdownManager();
        this.components.autoUpdater = new AutoUpdater();
        
        // Load configuration
        this.config = this.components.configManager.loadConfig();
        
        // Initialize cache manager with performance stats
        this.components.cacheManager.initialize(this.components.performanceStats);
        
        // Create message and system event handlers
        this.components.messageHandler = new MessageHandler(
            this.components.databaseManager,
            this.components.webhookManager,
            this.components.cacheManager,
            this.components.performanceStats,
            this.components.autoUpdater
        );
        
        this.components.systemEventHandler = new SystemEventHandler(
            this.axiosInstance,
            this.config
        );
        
        this.components.memberManager = new MemberManager(
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
            console.log(`Logged in as ${client.user.tag}!`);
            
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
        
        console.log('Bot initialization completed - ready to relay messages');
        
        // Start periodic update checks
        this.components.autoUpdater.startPeriodicChecks();
    }

    /**
     * Start the bot
     */
    async start() {
        try {
            // Initialize database
            await this.components.databaseManager.initialize(this.components.performanceStats);
            
            // Initialize webhook manager
            this.components.webhookManager.initialize(this.axiosInstance, this.components.performanceStats);
            
            // Setup Discord client
            this.setupClient();
            
            // Register components for graceful shutdown
            this.components.shutdownManager.registerComponents(this.components);
            
            // Start the Discord client
            console.log('Attempting to log in...');
            await this.components.client.login(this.config.token);
            console.log('Bot logged in successfully');
            
        } catch (error) {
            console.error(`Failed to start bot: ${error.message}`);
            process.exit(1);
        }
    }
}

// Start the bot
const bot = new DiscordRelayBot();
bot.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
