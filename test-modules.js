#!/usr/bin/env node

/**
 * Module Structure Validation Test
 * Tests that all modules can be loaded and basic functionality works
 */

const path = require('path');
const fs = require('fs');

console.log('🔍 Testing Discord Relay Bot Modular Structure...\n');

// Test module loading
const modules = [
    { name: 'ConfigManager', path: './src/config/config.js' },
    { name: 'DatabaseManager', path: './src/database/database.js' },
    { name: 'WebhookManager', path: './src/webhook/webhook.js' },
    { name: 'CacheManager', path: './src/cache/cache.js' },
    { name: 'MessageHandler', path: './src/handlers/messageHandler.js' },
    { name: 'SystemEventHandler', path: './src/handlers/systemEventHandler.js' },
    { name: 'MemberManager', path: './src/handlers/memberManager.js' },
    { name: 'PerformanceStats', path: './src/utils/performance.js' },
    { name: 'ShutdownManager', path: './src/utils/shutdown.js' },
    { name: 'MessageUtils', path: './src/utils/messageUtils.js' },
    { name: 'AutoUpdater', path: './src/utils/autoUpdater.js' }
];

let passedTests = 0;
let totalTests = modules.length;

// Test each module
modules.forEach(({ name, path: modulePath }) => {
    try {
        const ModuleClass = require(modulePath);
        
        // Test if it's a class/constructor
        if (typeof ModuleClass === 'function') {
            console.log(`✅ ${name}: Module loaded successfully`);
            passedTests++;
        } else {
            console.log(`❌ ${name}: Module is not a proper class`);
        }
    } catch (error) {
        console.log(`❌ ${name}: Failed to load - ${error.message}`);
    }
});

// Test main app.js structure
try {
    const appPath = './app.js';
    const appContent = fs.readFileSync(appPath, 'utf8');
    
    // Check if it contains the DiscordRelayBot class
    if (appContent.includes('class DiscordRelayBot')) {
        console.log('✅ app.js: Main application structure found');
        passedTests++;
        totalTests++;
    } else {
        console.log('❌ app.js: Missing DiscordRelayBot class');
        totalTests++;
    }
} catch (error) {
    console.log(`❌ app.js: Failed to read - ${error.message}`);
    totalTests++;
}

// Test directory structure
const expectedDirs = [
    './src/cache',
    './src/config',
    './src/database',
    './src/handlers',
    './src/utils',
    './src/webhook'
];

expectedDirs.forEach(dir => {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        console.log(`✅ Directory: ${dir} exists`);
        passedTests++;
    } else {
        console.log(`❌ Directory: ${dir} missing`);
    }
    totalTests++;
});

// Summary
console.log(`\n📊 Test Results:`);
console.log(`✅ Passed: ${passedTests}/${totalTests}`);
console.log(`❌ Failed: ${totalTests - passedTests}/${totalTests}`);

// Auto Updater Specific Tests
console.log('\n🔧 Running Auto Updater Specific Tests...\n');

async function testAutoUpdater() {
    let autoUpdaterTests = 0;
    let autoUpdaterPassed = 0;
    
    try {
        const AutoUpdater = require('./src/utils/autoUpdater.js');
        const updater = new AutoUpdater();
        
        // Test 1: Version parsing
        autoUpdaterTests++;
        const currentVersion = updater.getCurrentVersion();
        if (currentVersion && currentVersion !== '1.0.0') {
            console.log(`✅ AutoUpdater: Version parsing successful (${currentVersion})`);
            autoUpdaterPassed++;
        } else {
            console.log(`❌ AutoUpdater: Version parsing failed or using fallback`);
        }
        
        // Test 2: Version comparison
        autoUpdaterTests++;
        const isUpdateAvailable1 = updater.isUpdateAvailable('1.0.1');
        const isUpdateAvailable2 = updater.isUpdateAvailable('0.9.0');
        if (isUpdateAvailable1 === true && isUpdateAvailable2 === false) {
            console.log(`✅ AutoUpdater: Version comparison logic working`);
            autoUpdaterPassed++;
        } else {
            console.log(`❌ AutoUpdater: Version comparison logic failed`);
        }
        
        // Test 3: Update check timing
        autoUpdaterTests++;
        const shouldCheck = updater.shouldCheckForUpdate();
        if (typeof shouldCheck === 'boolean') {
            console.log(`✅ AutoUpdater: Update check timing logic working`);
            autoUpdaterPassed++;
        } else {
            console.log(`❌ AutoUpdater: Update check timing logic failed`);
        }
        
        // Test 4: GitHub API fetch (with timeout)
        autoUpdaterTests++;
        console.log(`🔍 AutoUpdater: Testing GitHub API fetch...`);
        try {
            const releaseInfo = await Promise.race([
                updater.fetchLatestRelease(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Test timeout')), 5000)
                )
            ]);
            
            if (releaseInfo && releaseInfo.tag_name) {
                console.log(`✅ AutoUpdater: GitHub API fetch successful (Latest: ${releaseInfo.tag_name})`);
                autoUpdaterPassed++;
            } else {
                console.log(`⚠️  AutoUpdater: GitHub API returned no release info`);
            }
        } catch (error) {
            console.log(`⚠️  AutoUpdater: GitHub API fetch failed (${error.message})`);
            console.log(`   This is expected if offline or repo doesn't exist`);
        }
        
        // Test 5: Force update check
        autoUpdaterTests++;
        console.log(`🔍 AutoUpdater: Testing force update check...`);
        try {
            const forceResult = await Promise.race([
                updater.forceUpdateCheck(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Test timeout')), 5000)
                )
            ]);
            
            if (typeof forceResult === 'boolean') {
                console.log(`✅ AutoUpdater: Force update check completed`);
                autoUpdaterPassed++;
            } else {
                console.log(`❌ AutoUpdater: Force update check returned invalid result`);
            }
        } catch (error) {
            console.log(`⚠️  AutoUpdater: Force update check failed (${error.message})`);
        }
        
    } catch (error) {
        console.log(`❌ AutoUpdater: Failed to initialize - ${error.message}`);
    }
    
    console.log(`\n🔧 Auto Updater Test Results:`);
    console.log(`✅ Passed: ${autoUpdaterPassed}/${autoUpdaterTests}`);
    console.log(`❌ Failed: ${autoUpdaterTests - autoUpdaterPassed}/${autoUpdaterTests}`);
    
    return { passed: autoUpdaterPassed, total: autoUpdaterTests };
}

// Run auto updater tests
testAutoUpdater().then(results => {
    const totalPassed = passedTests + results.passed;
    const totalTestsOverall = totalTests + results.total;
    
    console.log(`\n📊 Overall Results:`);
    console.log(`✅ Total Passed: ${totalPassed}/${totalTestsOverall}`);
    console.log(`❌ Total Failed: ${totalTestsOverall - totalPassed}/${totalTestsOverall}`);
    
    if (totalPassed === totalTestsOverall) {
        console.log('\n🎉 All tests passed! Everything is working correctly.');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some tests failed. Please check the results above.');
        process.exit(1);
    }
}).catch(error => {
    console.error('Error running auto updater tests:', error);
    process.exit(1);
});

// Remove the original exit calls since we're now using async
return;
