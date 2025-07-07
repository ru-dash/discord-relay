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
            channelMappings: []
        };
        this.config = { 
            botName: 'example-bot',
            token: '', 
            eventHook: '',
            channelMappings: []
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
            if (!mapping.channelId || !mapping.webhookUrl) {
                throw new Error(`Invalid mapping at index ${index}: missing channelId or webhookUrl`);
            }
        });
        
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
}

module.exports = ConfigManager;
