const axios = require('axios');
const semver = require('semver');
const fs = require('fs');
const path = require('path');

class AutoUpdater {
    constructor() {
        this.currentVersion = this.getCurrentVersion();
        this.repoUrl = 'https://api.github.com/repos/ru-dash/discord-relay/releases/latest';
        this.updateCheckInterval = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.lastCheckFile = path.join(__dirname, '../../.last-update-check');
    }

    /**
     * Get current version from package.json
     */
    getCurrentVersion() {
        try {
            const packagePath = path.join(__dirname, '../../package.json');
            const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            return packageData.version;
        } catch (error) {
            console.error('Error reading package.json:', error.message);
            return '1.0.0';
        }
    }

    /**
     * Check if update check is needed based on last check time
     */
    shouldCheckForUpdate() {
        try {
            if (!fs.existsSync(this.lastCheckFile)) {
                return true;
            }
            
            const lastCheck = parseInt(fs.readFileSync(this.lastCheckFile, 'utf8'));
            const timeSinceLastCheck = Date.now() - lastCheck;
            
            return timeSinceLastCheck > this.updateCheckInterval;
        } catch (error) {
            // If we can't read the file, assume we should check
            return true;
        }
    }

    /**
     * Update the last check timestamp
     */
    updateLastCheckTime() {
        try {
            fs.writeFileSync(this.lastCheckFile, Date.now().toString());
        } catch (error) {
            console.error('Error updating last check time:', error.message);
        }
    }

    /**
     * Fetch latest release information from GitHub
     */
    async fetchLatestRelease() {
        try {
            const response = await axios.get(this.repoUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Discord-Relay-Bot-Updater',
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (response.status === 200) {
                return response.data;
            }
            
            throw new Error(`GitHub API returned status ${response.status}`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log('Repository not found or releases not available');
                return null;
            }
            throw error;
        }
    }

    /**
     * Compare versions and determine if update is available
     */
    isUpdateAvailable(latestVersion) {
        try {
            // Clean version strings (remove 'v' prefix if present)
            const current = this.currentVersion.replace(/^v/, '');
            const latest = latestVersion.replace(/^v/, '');

            // Use semver to compare versions
            return semver.gt(latest, current);
        } catch (error) {
            console.error('Error comparing versions:', error.message);
            return false;
        }
    }

    /**
     * Display update notification
     */
    displayUpdateNotification(releaseInfo) {
        console.log('\n' + '='.repeat(60));
        console.log('🚀 UPDATE AVAILABLE!');
        console.log('='.repeat(60));
        console.log(`Current Version: ${this.currentVersion}`);
        console.log(`Latest Version:  ${releaseInfo.tag_name}`);
        console.log(`Release Date:    ${new Date(releaseInfo.published_at).toLocaleDateString()}`);
        console.log(`Release URL:     ${releaseInfo.html_url}`);
        
        if (releaseInfo.body) {
            console.log('\nRelease Notes:');
            console.log('-'.repeat(40));
            // Limit release notes to first 500 characters
            const notes = releaseInfo.body.substring(0, 500);
            console.log(notes + (releaseInfo.body.length > 500 ? '...' : ''));
        }
        
        console.log('\nTo update:');
        console.log('1. Visit the release URL above');
        console.log('2. Download the latest version');
        console.log('3. Replace your current files');
        console.log('4. Restart the bot');
        console.log('='.repeat(60) + '\n');
    }

    /**
     * Check for updates (main method)
     */
    async checkForUpdates(forceCheck = false) {
        // Skip check if not forced and not enough time has passed
        if (!forceCheck && !this.shouldCheckForUpdate()) {
            return false;
        }

        try {
            console.log('Checking for updates...');
            
            const releaseInfo = await this.fetchLatestRelease();
            
            // Update last check time
            this.updateLastCheckTime();
            
            if (!releaseInfo) {
                console.log('No release information available');
                return false;
            }

            const latestVersion = releaseInfo.tag_name;
            
            if (this.isUpdateAvailable(latestVersion)) {
                this.displayUpdateNotification(releaseInfo);
                return true;
            } else {
                console.log(`✅ You are running the latest version (${this.currentVersion})`);
                return false;
            }
            
        } catch (error) {
            console.error('Error checking for updates:', error.message);
            return false;
        }
    }

    /**
     * Start periodic update checks
     */
    startPeriodicChecks() {
        // Check immediately on startup
        setTimeout(() => {
            this.checkForUpdates();
        }, 5000); // Wait 5 seconds after startup

        // Set up recurring checks
        setInterval(() => {
            this.checkForUpdates();
        }, this.updateCheckInterval);
    }

    /**
     * Force an update check (useful for debug commands)
     */
    async forceUpdateCheck() {
        console.log('Forcing update check...');
        return await this.checkForUpdates(true);
    }
}

module.exports = AutoUpdater;
