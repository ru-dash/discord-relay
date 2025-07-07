const fs = require('fs');
const path = require('path');

class StatusTracker {
    constructor() {
        this.statusFile = path.join(__dirname, '../../status.json');
        this.ensureStatusFile();
    }

    /**
     * Ensure status file exists
     */
    ensureStatusFile() {
        if (!fs.existsSync(this.statusFile)) {
            this.saveStatus({});
        }
    }

    /**
     * Load status from file
     * @returns {Object} - Status object
     */
    loadStatus() {
        try {
            const statusContent = fs.readFileSync(this.statusFile, 'utf8');
            return JSON.parse(statusContent);
        } catch (error) {
            console.warn('Error loading status file, creating new one:', error.message);
            this.saveStatus({});
            return {};
        }
    }

    /**
     * Save status to file
     * @param {Object} status - Status object to save
     */
    saveStatus(status) {
        try {
            fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
        } catch (error) {
            console.error('Error saving status file:', error.message);
        }
    }

    /**
     * Update instance status
     * @param {string} instanceName - Name of the instance
     * @param {Object} statusData - Status data
     */
    updateInstanceStatus(instanceName, statusData) {
        const status = this.loadStatus();
        status[instanceName] = {
            ...statusData,
            lastUpdated: new Date().toISOString()
        };
        this.saveStatus(status);
    }

    /**
     * Remove instance from status
     * @param {string} instanceName - Name of the instance
     */
    removeInstance(instanceName) {
        const status = this.loadStatus();
        delete status[instanceName];
        this.saveStatus(status);
    }

    /**
     * Get instance status
     * @param {string} instanceName - Name of the instance
     * @returns {Object|null} - Instance status or null if not found
     */
    getInstanceStatus(instanceName) {
        const status = this.loadStatus();
        return status[instanceName] || null;
    }

    /**
     * Get all instances status
     * @returns {Object} - All instances status
     */
    getAllStatus() {
        return this.loadStatus();
    }

    /**
     * Check if instance is running by PID
     * @param {number} pid - Process ID
     * @returns {boolean} - True if process is running
     */
    isProcessRunning(pid) {
        if (!pid) return false;
        
        try {
            // On Windows, this will throw if process doesn't exist
            process.kill(pid, 0);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Clean up stale instances (processes that are no longer running)
     */
    cleanupStaleInstances() {
        const status = this.loadStatus();
        let hasChanges = false;

        for (const [instanceName, instanceStatus] of Object.entries(status)) {
            if (instanceStatus.pid && !this.isProcessRunning(instanceStatus.pid)) {
                console.log(`Cleaning up stale instance: ${instanceName}`);
                delete status[instanceName];
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this.saveStatus(status);
        }
    }
}

module.exports = StatusTracker;
