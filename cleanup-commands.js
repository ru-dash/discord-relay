const fs = require('fs').promises;
const path = require('path');

/**
 * Cleanup utility for removing old command files and temporary files
 */
class CommandCleanup {
    constructor(commandsDir = './commands') {
        this.commandsDir = commandsDir;
        this.maxAgeHours = 24; // Default: remove files older than 24 hours
        this.patterns = [
            /.*-fetch-reactions-\d+-result\.json$/,     // fetch-reactions result files
            /.*-fetch-guild-channels-\d+-result\.json$/, // fetch-guild-channels result files
            /^temp_.*$/,                                 // temp_ prefixed files
            /.*_temp\.js$/,                              // _temp.js suffixed files
            /^manual_.*$/,                               // manual_ prefixed files
            /.*\.tmp$/,                                  // .tmp files
            /.*\.backup$/,                               // .backup files
            /.*\.bak$/                                   // .bak files
        ];
    }

    /**
     * Check if a file matches cleanup patterns
     * @param {string} filename - File name to check
     * @returns {boolean} - True if file should be cleaned up
     */
    shouldCleanup(filename) {
        return this.patterns.some(pattern => pattern.test(filename));
    }

    /**
     * Check if a file is older than maxAgeHours
     * @param {string} filePath - Full path to file
     * @returns {Promise<boolean>} - True if file is old enough to clean up
     */
    async isOldEnough(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const ageMs = Date.now() - stats.mtime.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            return ageHours > this.maxAgeHours;
        } catch (error) {
            console.warn(`Error checking file age for ${filePath}:`, error.message);
            return false;
        }
    }

    /**
     * Clean up old command files
     * @param {boolean} dryRun - If true, only log what would be deleted
     * @returns {Promise<{deleted: string[], errors: string[]}>}
     */
    async cleanup(dryRun = false) {
        const results = {
            deleted: [],
            errors: []
        };

        try {
            // Check if commands directory exists
            try {
                await fs.access(this.commandsDir);
            } catch (error) {
                console.log(`Commands directory ${this.commandsDir} does not exist, nothing to clean up`);
                return results;
            }

            const files = await fs.readdir(this.commandsDir);
            console.log(`Found ${files.length} files in ${this.commandsDir}`);

            for (const filename of files) {
                const filePath = path.join(this.commandsDir, filename);
                
                try {
                    const stats = await fs.stat(filePath);
                    
                    // Skip directories
                    if (stats.isDirectory()) {
                        continue;
                    }

                    // Check if file matches cleanup patterns
                    if (this.shouldCleanup(filename)) {
                        // Check if file is old enough
                        if (await this.isOldEnough(filePath)) {
                            if (dryRun) {
                                console.log(`[DRY RUN] Would delete: ${filename} (${this.getFileAge(stats)} old)`);
                                results.deleted.push(filename);
                            } else {
                                await fs.unlink(filePath);
                                console.log(`Deleted: ${filename} (${this.getFileAge(stats)} old)`);
                                results.deleted.push(filename);
                            }
                        } else {
                            console.log(`Skipping ${filename} (too recent: ${this.getFileAge(stats)} old)`);
                        }
                    }
                } catch (error) {
                    const errorMsg = `Error processing ${filename}: ${error.message}`;
                    console.error(errorMsg);
                    results.errors.push(errorMsg);
                }
            }

            console.log(`Cleanup complete. Processed: ${files.length}, Deleted: ${results.deleted.length}, Errors: ${results.errors.length}`);
            
        } catch (error) {
            const errorMsg = `Error reading commands directory: ${error.message}`;
            console.error(errorMsg);
            results.errors.push(errorMsg);
        }

        return results;
    }

    /**
     * Get human-readable file age
     * @param {fs.Stats} stats - File stats object
     * @returns {string} - Human-readable age
     */
    getFileAge(stats) {
        const ageMs = Date.now() - stats.mtime.getTime();
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        const ageDays = Math.floor(ageHours / 24);
        
        if (ageDays > 0) {
            return `${ageDays} day${ageDays === 1 ? '' : 's'}`;
        } else if (ageHours > 0) {
            return `${ageHours} hour${ageHours === 1 ? '' : 's'}`;
        } else {
            return 'less than 1 hour';
        }
    }

    /**
     * Set the maximum age for files to be cleaned up
     * @param {number} hours - Maximum age in hours
     */
    setMaxAge(hours) {
        this.maxAgeHours = hours;
    }

    /**
     * Add a custom cleanup pattern
     * @param {RegExp} pattern - Regular expression pattern to match filenames
     */
    addPattern(pattern) {
        this.patterns.push(pattern);
    }
}

// Export for use in other modules
module.exports = CommandCleanup;

// If run directly, perform cleanup
if (require.main === module) {
    const cleanup = new CommandCleanup();
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-n');
    const force = args.includes('--force') || args.includes('-f');
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Command Cleanup Utility

Usage: node cleanup-commands.js [options]

Options:
  --dry-run, -n    Show what would be deleted without actually deleting
  --force, -f      Delete files regardless of age
  --help, -h       Show this help message

Examples:
  node cleanup-commands.js --dry-run    # See what would be deleted
  node cleanup-commands.js              # Delete old files (older than 24 hours)
  node cleanup-commands.js --force      # Delete all matching files regardless of age
        `);
        process.exit(0);
    }

    if (force) {
        cleanup.setMaxAge(0); // Delete all files regardless of age
        console.log('Force mode: will delete all matching files regardless of age');
    }

    console.log(`Starting cleanup of commands directory...`);
    console.log(`Max age: ${cleanup.maxAgeHours} hours`);
    console.log(`Dry run: ${dryRun ? 'YES' : 'NO'}`);
    console.log('');

    cleanup.cleanup(dryRun)
        .then(results => {
            console.log('');
            console.log('=== CLEANUP SUMMARY ===');
            console.log(`Files deleted: ${results.deleted.length}`);
            if (results.deleted.length > 0) {
                console.log('Deleted files:', results.deleted.join(', '));
            }
            if (results.errors.length > 0) {
                console.log(`Errors: ${results.errors.length}`);
                console.log('Errors:', results.errors.join(', '));
            }
            
            process.exit(results.errors.length > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('Fatal error during cleanup:', error.message);
            process.exit(1);
        });
}
