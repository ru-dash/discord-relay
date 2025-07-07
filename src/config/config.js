const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor(configPath) {
        this.configPath = configPath || path.join(__dirname, '../../config.json');
        this.defaultConfig = { token: '', channelMappings: [] };
        this.config = { token: '', channelMappings: [] };
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
                const configFileContent = fs.readFileSync(this.configPath, 'utf8');
                this.config = JSON.parse(configFileContent);
                this.validateConfig(this.config);
                console.log('Config loaded and validated successfully.');
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
}

module.exports = ConfigManager;
