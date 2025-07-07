const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor(configPath) {
        this.configPath = configPath || path.join(__dirname, '../../config.json');
        this.globalSettingsPath = path.join(__dirname, '../../settings.json');
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
}

module.exports = ConfigManager;
