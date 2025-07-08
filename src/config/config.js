const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class ConfigManager extends EventEmitter {
    constructor(configPath) {
        super();
        this.configPath = configPath || path.join(__dirname, '../../config.json');
        this.globalSettingsPath = path.join(__dirname, '../../settings.json');
        this.fileWatcher = null;
        this.globalWatcher = null;
        this.watchEnabled = false;
        this.defaultConfig = { 
            botName: 'example-bot',
            token: '', 
            eventHook: '',
            channelMappings: [],
            everyoneCatch: []
        };
        this.config = { 
            botName: 'example-bot',
            token: '', 
            eventHook: '',
            channelMappings: [],
            everyoneCatch: []
        };
    }

    /**
     * Load global settings from settings.json
     * @returns {Object} - Global settings
     */
    loadGlobalSettings() {
        try {
            if (fs.existsSync(this.globalSettingsPath)) {
                const globalContent = fs.readFileSync(this.globalSettingsPath, 'utf8');
                const globalSettings = JSON.parse(globalContent);
                return globalSettings.global || {};
            }
        } catch (error) {
            console.warn('Failed to load global settings:', error.message);
        }
        return {};
    }

    /**
     * Validate config structure
     * @param {Object} config - Configuration object to validate
     * @returns {boolean} - True if valid
     * @throws {Error} - If validation fails
     */
    validateConfig(config) {
        if (!config.token || typeof config.token !== 'string') {
            throw new Error('Invalid token in config');
        }
        if (!Array.isArray(config.channelMappings)) {
            throw new Error('channelMappings must be an array');
        }
        config.channelMappings.forEach((mapping, index) => {
            // Support both old format (channelId) and new format (channelName + guildId)
            if (!mapping.webhookUrl) {
                throw new Error(`Invalid mapping at index ${index}: missing webhookUrl`);
            }
            if (!mapping.channelId && !mapping.channelName) {
                throw new Error(`Invalid mapping at index ${index}: missing channelId or channelName`);
            }
            if (mapping.channelName && !mapping.guildId) {
                throw new Error(`Invalid mapping at index ${index}: channelName requires guildId`);
            }
        });

        // Validate everyoneCatch if present
        if (config.everyoneCatch && Array.isArray(config.everyoneCatch)) {
            config.everyoneCatch.forEach((catchMapping, index) => {
                if (!catchMapping.guildId || !catchMapping.webhookUrl) {
                    throw new Error(`Invalid everyoneCatch at index ${index}: missing guildId or webhookUrl`);
                }
            });
        }
        
        // Set default values for optional fields
        if (!config.botName) {
            config.botName = 'example-bot';
        }
        
        return true;
    }

    /**
     * Load configuration from file
     * @returns {Object} - Loaded configuration
     */
    loadConfig() {
        if (!fs.existsSync(this.configPath)) {
            fs.writeFileSync(this.configPath, JSON.stringify(this.defaultConfig, null, 2));
            console.log('Config file generated. Please fill in the details.');
            process.exit(0);
        } else {
            try {
                // Load bot-specific config
                const configFileContent = fs.readFileSync(this.configPath, 'utf8');
                const botConfig = JSON.parse(configFileContent);
                
                // Load global settings
                const globalSettings = this.loadGlobalSettings();
                
                // Merge global settings with bot config
                this.config = {
                    ...botConfig,
                    // Add global settings
                    systemHook: globalSettings.systemHook || '',
                    database: globalSettings.database || {},
                    // Use botName for both agentName and instanceName for backward compatibility
                    agentName: botConfig.botName || 'example-bot',
                    instanceName: botConfig.botName || 'example-bot'
                };
                
                this.validateConfig(this.config);
                console.log('Config loaded and validated successfully.');
                console.log(`Bot: ${this.config.botName} (${this.config.agentName})`);
                return this.config;
            } catch (error) {
                console.error('Failed to read, parse, or validate config file:', error.message);
                process.exit(1);
            }
        }
    }

    /**
     * Get configuration
     * @returns {Object} - Current configuration
     */
    getConfig() {
        return this.config;
    }

    /**
     * Get channel mappings as a Map
     * @returns {Map} - Channel ID to webhook URL mappings
     */
    getChannelMappings() {
        const channelWebhookMap = new Map();
        this.config.channelMappings.forEach(mapping => {
            channelWebhookMap.set(mapping.channelId, mapping.webhookUrl);
        });
        return channelWebhookMap;
    }

    /**
     * Get database path from configuration
     * @returns {string} - Database file path
     */
    getDatabasePath() {
        return this.config.dbPath || `./databases/${this.config.botName || 'default'}.db`;
    }

    /**
     * Get instance name from configuration
     * @returns {string} - Instance name
     */
    getInstanceName() {
        return this.config.instanceName || this.config.botName || 'default';
    }

    /**
     * Get agent name from configuration
     * @returns {string} - Agent name
     */
    getAgentName() {
        return this.config.agentName || this.config.botName || 'Discord Relay Bot';
    }

    /**
     * Get bot name from configuration
     * @returns {string} - Bot name
     */
    getBotName() {
        return this.config.botName || 'example-bot';
    }

    /**
     * Check if a channel name matches a pattern
     * @param {string} channelName - The channel name to check
     * @param {string} pattern - The pattern to match against
     * @returns {boolean} - True if matches
     */
    matchesChannelPattern(channelName, pattern) {
        // Exact match (quoted or unquoted)
        if (pattern === channelName || pattern === `"${channelName}"`) {
            return true;
        }

        // Wildcard patterns
        if (pattern.includes('*')) {
            // Convert pattern to regex
            const regexPattern = pattern
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars except *
                .replace(/\\\*/g, '.*'); // Convert * to .*
            
            const regex = new RegExp(`^${regexPattern}$`, 'i');
            return regex.test(channelName);
        }

        // Case-insensitive exact match
        return channelName.toLowerCase() === pattern.toLowerCase();
    }

    /**
     * Get webhook URL for a channel based on ID or name pattern
     * @param {string} channelId - Discord channel ID
     * @param {string} channelName - Channel name
     * @param {string} guildId - Guild ID
     * @returns {Object|null} - Object with webhookUrl and redactChannelName if found
     */
    getWebhookForChannel(channelId, channelName, guildId) {
        for (const mapping of this.config.channelMappings) {
            // Check by channel ID (legacy support)
            if (mapping.channelId && mapping.channelId === channelId) {
                return {
                    webhookUrl: mapping.webhookUrl,
                    redactChannelName: mapping.redactChannelName || false
                };
            }

            // Check by channel name pattern within guild
            if (mapping.channelName && mapping.guildId === guildId) {
                if (this.matchesChannelPattern(channelName, mapping.channelName)) {
                    return {
                        webhookUrl: mapping.webhookUrl,
                        redactChannelName: mapping.redactChannelName || false
                    };
                }
            }
        }
        return null;
    }

    /**
     * Get everyone catch webhook for a guild
     * @param {string} guildId - Guild ID
     * @returns {string|null} - Webhook URL if found
     */
    getEveryoneCatchWebhook(guildId) {
        if (!this.config.everyoneCatch) return null;
        
        const catchMapping = this.config.everyoneCatch.find(mapping => mapping.guildId === guildId);
        return catchMapping ? catchMapping.webhookUrl : null;
    }

    /**
     * Get all everyone catch mappings
     * @returns {Array} - Array of everyone catch mappings
     */
    getEveryoneCatchMappings() {
        return this.config.everyoneCatch || [];
    }

    /**
     * Start watching config files for changes
     */
    startWatching() {
        if (this.watchEnabled) {
            console.log('Config watching is already enabled');
            return;
        }

        this.watchEnabled = true;
        console.log('Starting config file watching...');

        try {
            // Watch the main config file
            if (fs.existsSync(this.configPath)) {
                this.fileWatcher = fs.watch(this.configPath, { persistent: false }, (eventType, filename) => {
                    if (eventType === 'change') {
                        console.log(`Config file changed: ${filename}`);
                        this.reloadConfig();
                    }
                });
                console.log(`Watching config file: ${this.configPath}`);
            }

            // Watch the global settings file
            if (fs.existsSync(this.globalSettingsPath)) {
                this.globalWatcher = fs.watch(this.globalSettingsPath, { persistent: false }, (eventType, filename) => {
                    if (eventType === 'change') {
                        console.log(`Global settings file changed: ${filename}`);
                        this.reloadConfig();
                    }
                });
                console.log(`Watching global settings file: ${this.globalSettingsPath}`);
            }

            // Handle watcher errors
            if (this.fileWatcher) {
                this.fileWatcher.on('error', (error) => {
                    console.error('Config file watcher error:', error.message);
                    this.stopWatching();
                });
            }

            if (this.globalWatcher) {
                this.globalWatcher.on('error', (error) => {
                    console.error('Global settings file watcher error:', error.message);
                    this.stopWatching();
                });
            }

        } catch (error) {
            console.error('Failed to start config file watching:', error.message);
            this.stopWatching();
        }
    }

    /**
     * Stop watching config files
     */
    stopWatching() {
        if (!this.watchEnabled) return;

        console.log('Stopping config file watching...');
        this.watchEnabled = false;

        if (this.fileWatcher) {
            this.fileWatcher.close();
            this.fileWatcher = null;
        }

        if (this.globalWatcher) {
            this.globalWatcher.close();
            this.globalWatcher = null;
        }
    }

    /**
     * Reload configuration from files
     */
    reloadConfig() {
        console.log('Reloading configuration...');
        
        // Add a small delay to ensure file write is complete
        setTimeout(() => {
            try {
                const oldConfig = { ...this.config };
                
                // Load bot-specific config
                const configFileContent = fs.readFileSync(this.configPath, 'utf8');
                const botConfig = JSON.parse(configFileContent);
                
                // Load global settings
                const globalSettings = this.loadGlobalSettings();
                
                // Merge global settings with bot config
                this.config = {
                    ...botConfig,
                    // Add global settings
                    systemHook: globalSettings.systemHook || '',
                    database: globalSettings.database || {},
                    // Use botName for both agentName and instanceName for backward compatibility
                    agentName: botConfig.botName || 'example-bot',
                    instanceName: botConfig.botName || 'example-bot'
                };
                
                // Validate the new config
                this.validateConfig(this.config);
                
                console.log('Configuration reloaded successfully');
                console.log(`Bot: ${this.config.botName} (${this.config.agentName})`);
                
                // Get detailed changes
                const changes = this.getConfigChanges(oldConfig, this.config);
                
                // Log changes for debugging
                if (Object.keys(changes).length > 0) {
                    console.log('Configuration changes detected:');
                    Object.keys(changes).forEach(key => {
                        console.log(`  ${key}: ${JSON.stringify(changes[key].old)} -> ${JSON.stringify(changes[key].new)}`);
                    });
                } else {
                    console.log('No configuration changes detected');
                }
                
                // Emit config changed event
                this.emit('configChanged', {
                    oldConfig,
                    newConfig: this.config,
                    changes
                });
                
            } catch (error) {
                console.error('Failed to reload configuration:', error.message);
                console.error('Keeping previous configuration');
            }
        }, 100); // 100ms delay
    }

    /**
     * Compare two config objects and return differences
     */
    getConfigChanges(oldConfig, newConfig) {
        const changes = {};
        
        // Check for changed values
        for (const key of Object.keys(newConfig)) {
            if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
                changes[key] = {
                    old: oldConfig[key],
                    new: newConfig[key]
                };
            }
        }
        
        // Check for removed values
        for (const key of Object.keys(oldConfig)) {
            if (!(key in newConfig)) {
                changes[key] = {
                    old: oldConfig[key],
                    new: undefined
                };
            }
        }
        
        return changes;
    }
}

module.exports = ConfigManager;
