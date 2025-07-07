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
    { name: 'MessageUtils', path: './src/utils/messageUtils.js' }
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

if (passedTests === totalTests) {
    console.log('\n🎉 All tests passed! Modular structure is valid.');
    process.exit(0);
} else {
    console.log('\n⚠️  Some tests failed. Please check the module structure.');
    process.exit(1);
}
