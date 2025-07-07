const axios = require('axios');
const semver = require('semver');
const fs = require('fs');
const path = require('path');

class AutoUpdater {
    constructor() {
        this.currentVersion = this.getCurrentVersion();
        this.repoUrl = 'https://api.github.com/repos/ru-dash/discord-relay/releases/latest';
        this.updateCheckInterval = 60 * 60 * 1000; // 1 hour in milliseconds
        this.lastCheckFile = path.join(__dirname, '../../.last-update-check');
        
        // Use OS temp directory for downloads and extraction
        const os = require('os');
        this.tempDir = path.join(os.tmpdir(), 'discord-relay-updater');
        this.downloadPath = path.join(this.tempDir, 'downloads');
        this.extractPath = path.join(this.tempDir, 'extracted');
        
        this.autoDownload = true; // Always enabled
        this.autoInstall = true; // Always enabled
        this.createBackup = false; // Disabled - no permanent backup folders
        
        // Files that must NEVER be touched during updates
        this.preserveFiles = [
            'config.json',
            '.last-update-check',
            'node_modules/',
            '.git/',
            '.env',
            '.gitignore'
        ];
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
    displayUpdateNotification(releaseInfo, downloadedFile = null) {
        console.log('\n' + '='.repeat(60));
        
        if (downloadedFile) {
            console.log('✅ UPDATE INSTALLED AUTOMATICALLY!');
            console.log('='.repeat(60));
            console.log('🎉 Your bot has been updated automatically');
            console.log('🔄 Please restart the bot to use the new version');
            console.log('💾 Your config.json was preserved');
            console.log('🗑️  No permanent files created (temporary only)');
        } else {
            console.log('🚀 UPDATE AVAILABLE!');
            console.log('='.repeat(60));
            console.log('💡 Auto-install failed - manual update required');
        }
        
        console.log(`Current Version: ${this.currentVersion}`);
        console.log(`Latest Version:  ${releaseInfo.tag_name}`);
        console.log(`Release Date:    ${new Date(releaseInfo.published_at).toLocaleDateString()}`);
        console.log(`Release URL:     ${releaseInfo.html_url}`);
        
        if (releaseInfo.body) {
            console.log('\nRelease Notes:');
            console.log('-'.repeat(40));
            // Limit release notes to first 300 characters
            const notes = releaseInfo.body.substring(0, 300);
            console.log(notes + (releaseInfo.body.length > 300 ? '...' : ''));
        }
        
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
                let downloadedFile = null;
                
                // Auto download and install if enabled
                if (this.autoDownload && this.autoInstall) {
                    try {
                        downloadedFile = await this.downloadLatestRelease(releaseInfo);
                        await this.installUpdate(downloadedFile);
                        console.log('🎉 Update automatically installed!');
                    } catch (error) {
                        console.error('Auto install failed:', error.message);
                        console.log('💡 Manual update may be required');
                    }
                }
                
                this.displayUpdateNotification(releaseInfo, downloadedFile);
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

    /**
     * Ensure temporary directories exist
     */
    ensureTempDirectories() {
        const fs = require('fs');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        if (!fs.existsSync(this.downloadPath)) {
            fs.mkdirSync(this.downloadPath, { recursive: true });
        }
        if (!fs.existsSync(this.extractPath)) {
            fs.mkdirSync(this.extractPath, { recursive: true });
        }
    }

    /**
     * Clean up temporary directories
     */
    cleanupTempDirectories() {
        const fs = require('fs');
        try {
            if (fs.existsSync(this.tempDir)) {
                this.removeDirectory(this.tempDir);
                console.log('✅ Temporary files cleaned up');
            }
        } catch (error) {
            console.warn('⚠️  Could not clean up temporary files:', error.message);
        }
    }

    /**
     * Download a file from URL
     */
    async downloadFile(url, outputPath, onProgress) {
        const axios = require('axios');
        const { promisify } = require('util');
        const { pipeline } = require('stream');
        const streamPipeline = promisify(pipeline);
        
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 300000, // 5 minutes timeout
            headers: {
                'User-Agent': 'Discord-Relay-Bot-Updater'
            }
        });

        const totalLength = response.headers['content-length'];
        let downloadedLength = 0;

        response.data.on('data', (chunk) => {
            downloadedLength += chunk.length;
            if (onProgress && totalLength) {
                const progress = Math.round((downloadedLength / totalLength) * 100);
                onProgress(progress, downloadedLength, totalLength);
            }
        });

        await streamPipeline(response.data, fs.createWriteStream(outputPath));
        return outputPath;
    }

    /**
     * Download the latest release to temporary directory
     */
    async downloadLatestRelease(releaseInfo) {
        try {
            console.log('\n📥 Downloading latest release...');
            this.ensureTempDirectories();

            // Find the main release asset (usually a .zip file)
            const assets = releaseInfo.assets || [];
            let downloadAsset = null;

            // Look for common release file patterns
            const patterns = [/\.zip$/i, /\.tar\.gz$/i, /\.tgz$/i, /source/i];

            for (const pattern of patterns) {
                downloadAsset = assets.find(asset => pattern.test(asset.name));
                if (downloadAsset) break;
            }

            // If no specific asset found, try the source code archive
            if (!downloadAsset && releaseInfo.zipball_url) {
                downloadAsset = {
                    name: `${releaseInfo.tag_name}-source.zip`,
                    browser_download_url: releaseInfo.zipball_url,
                    size: 0
                };
            }

            if (!downloadAsset) {
                throw new Error('No downloadable assets found in release');
            }

            const fileName = downloadAsset.name;
            const filePath = path.join(this.downloadPath, fileName);
            
            console.log(`📁 Downloading: ${fileName} (temporary)`);
            
            let lastProgress = 0;
            await this.downloadFile(
                downloadAsset.browser_download_url,
                filePath,
                (progress, downloaded, total) => {
                    // Only show progress every 25%
                    if (progress >= lastProgress + 25) {
                        console.log(`📊 Progress: ${progress}%`);
                        lastProgress = progress;
                    }
                }
            );

            console.log(`✅ Download completed (temporary)`);
            return filePath;

        } catch (error) {
            console.error('❌ Download failed:', error.message);
            throw error;
        }
    }

    /**
     * Extract downloaded update file to temporary directory
     */
    async extractUpdate(downloadedFile) {
        try {
            console.log('\n📦 Extracting update...');
            
            // Clean up any existing extraction
            if (fs.existsSync(this.extractPath)) {
                this.removeDirectory(this.extractPath);
            }
            
            fs.mkdirSync(this.extractPath, { recursive: true });
            
            if (downloadedFile.endsWith('.zip')) {
                const AdmZip = require('adm-zip');
                const zip = new AdmZip(downloadedFile);
                zip.extractAllTo(this.extractPath, true);
                
                // Find the main directory (GitHub zips usually have a root folder)
                const extractedContents = fs.readdirSync(this.extractPath);
                if (extractedContents.length === 1 && fs.statSync(path.join(this.extractPath, extractedContents[0])).isDirectory()) {
                    return path.join(this.extractPath, extractedContents[0]);
                }
                return this.extractPath;
            } else {
                throw new Error('Unsupported file format. Only .zip files are supported.');
            }
            
        } catch (error) {
            console.error('❌ Extraction failed:', error.message);
            throw error;
        }
    }

    /**
     * Replace current files with updated files (NO BACKUP)
     */
    async replaceFiles(extractPath) {
        try {
            console.log('\n🔄 Replacing files (preserving config)...');
            
            const rootDir = path.join(__dirname, '../..');
            const filesToReplace = ['app.js', 'src/', 'package.json'];
            
            console.log('🛡️  Protected files:', this.preserveFiles.join(', '));
            
            for (const file of filesToReplace) {
                const sourcePath = path.join(extractPath, file);
                const destPath = path.join(rootDir, file);
                
                if (fs.existsSync(sourcePath)) {
                    console.log(`🔄 Replacing: ${file}`);
                    
                    // Remove existing file/directory
                    if (fs.existsSync(destPath)) {
                        if (fs.statSync(destPath).isDirectory()) {
                            this.removeDirectory(destPath);
                        } else {
                            fs.unlinkSync(destPath);
                        }
                    }
                    
                    // Copy new file/directory
                    if (fs.statSync(sourcePath).isDirectory()) {
                        this.copyDirectory(sourcePath, destPath);
                    } else {
                        fs.copyFileSync(sourcePath, destPath);
                    }
                } else {
                    console.log(`⚠️  File not found in update: ${file}`);
                }
            }
            
        } catch (error) {
            console.error('❌ File replacement failed:', error.message);
            throw error;
        }
    }

    /**
     * Install downloaded update (NO BACKUP, TEMPORARY FILES ONLY)
     */
    async installUpdate(downloadedFile) {
        try {
            console.log('\n🔧 Installing update (no backup, temporary only)...');
            
            // Extract the downloaded file
            const extractedPath = await this.extractUpdate(downloadedFile);
            console.log(`📦 Update extracted (temporary)`);
            
            // Install the update
            await this.replaceFiles(extractedPath);
            console.log('✅ Files replaced successfully');
            
            // Clean up temporary files immediately
            this.cleanupTempDirectories();
            
            console.log('\n🎉 Update installed successfully!');
            console.log('🔄 Please restart the bot to use the new version');
            console.log('💾 No backup created - config.json preserved');
            
            return true;

        } catch (error) {
            console.error('❌ Installation failed:', error.message);
            // Clean up on error too
            this.cleanupTempDirectories();
            throw error;
        }
    }

    /**
     * Remove directory recursively
     */
    removeDirectory(dirPath) {
        if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                if (fs.statSync(filePath).isDirectory()) {
                    this.removeDirectory(filePath);
                } else {
                    fs.unlinkSync(filePath);
                }
            }
            fs.rmdirSync(dirPath);
        }
    }

    /**
     * Copy directory recursively
     */
    copyDirectory(source, destination) {
        if (!fs.existsSync(destination)) {
            fs.mkdirSync(destination, { recursive: true });
        }

        const files = fs.readdirSync(source);
        for (const file of files) {
            const sourcePath = path.join(source, file);
            const destPath = path.join(destination, file);

            if (fs.statSync(sourcePath).isDirectory()) {
                this.copyDirectory(sourcePath, destPath);
            } else {
                fs.copyFileSync(sourcePath, destPath);
            }
        }
    }

    // ...existing code...
}

module.exports = AutoUpdater;
