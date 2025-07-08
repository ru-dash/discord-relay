# Command Cleanup System

The Discord relay bot includes an automatic cleanup system for managing old command files and temporary files.

## What Gets Cleaned Up

The cleanup system removes the following types of files from the `commands/` directory:

- **Fetch-reactions result files**: `*-fetch-reactions-*-result.json`
- **Temporary files**: `temp_*`, `*_temp.js`, `*.tmp`
- **Manual scripts**: `manual_*`
- **Backup files**: `*.backup`, `*.bak`

## Automatic Cleanup

- **On startup**: The bot automatically cleans up files older than 24 hours when it starts
- **Periodic cleanup**: Every 6 hours, the bot runs a cleanup to remove old files
- **Age threshold**: By default, only files older than 24 hours are removed

## Manual Cleanup

You can manually run cleanup using npm scripts:

```bash
# See what would be deleted (dry run)
npm run cleanup-dry-run

# Delete old files (older than 24 hours)
npm run cleanup

# Force delete all matching files regardless of age
npm run cleanup-force
```

Or run the cleanup script directly:

```bash
# Show help
node cleanup-commands.js --help

# Dry run (see what would be deleted)
node cleanup-commands.js --dry-run

# Normal cleanup (files older than 24 hours)
node cleanup-commands.js

# Force cleanup (all matching files)
node cleanup-commands.js --force
```

## Configuration

The cleanup patterns are defined in `cleanup-commands.js` and can be customized by modifying the `patterns` array.

## Files Ignored by Git

The `.gitignore` file has been updated to ignore:

- Temporary command files
- Manual test scripts
- Old fetch-reactions results
- Backup files

This prevents these temporary files from being committed to the repository.

## Examples

```bash
# Check what old files exist
npm run cleanup-dry-run

# Clean up old files
npm run cleanup

# Emergency cleanup of all command files
npm run cleanup-force
```

The cleanup system helps keep your commands directory tidy and prevents it from filling up with old result files.
