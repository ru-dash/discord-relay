# Discord Relay Bot

A robust2. **Database Setup**
   ```bash
   # Run the PostgreSQL setup script
   node utils/setup-postgresql.js
   ```ord bot for relaying messages between channels with PostgreSQL storage, automatic crash recovery, and comprehensive error handling.

**Disclaimer:** Discord does not encourage the use of selfbots, so there is some risk of a ban!

## Features

* **Message Relay**: Relay messages from specific channels to Discord webhooks
* **Event Monitoring**: Track member events (joins/leaves, role changes) and channel updates
* **Poll Support**: Automatically relay Discord polls with voting options and results
* **PostgreSQL Database**: Persistent storage for messages, members, and events
* **In-Memory Caching**: Fast access with configurable RAM limits and TTL
* **Auto-Restart System**: Automatic recovery from crashes with smart error detection
* **Member Synchronization**: Periodic member list updates and lazy loading
* **System Notifications**: Critical error alerts via webhook notifications
* **Robust Error Handling**: Graceful shutdown and restart prevention for unrecoverable errors
* **Performance Monitoring**: Built-in performance statistics and logging
* **Poll Relay**: Discord polls are converted to rich embeds showing options, vote counts, and expiry times with links back to the original poll for voting

## Quick Setup

1. **Prerequisites**
   - Node.js 16+ from [nodejs.org](https://nodejs.org/)
   - PostgreSQL 12+ server

2. **Installation**
   ```bash
   git clone https://github.com/yourusername/discord-relay.git
   cd discord-relay
   npm install
   ```

3. **Database Setup**
   ```bash
   # Run the PostgreSQL setup script
   node setup-postgresql.js
   ```

4. **Configuration**
   - Copy `configs/example-bot.json` to `configs/your-bot.json`
   - Update global settings in `settings.json`:
     ```json
     {
       "global": {
         "systemHook": "https://discord.com/api/webhooks/...",
         "database": {
           "postgresql": {
             "host": "localhost",
             "port": 5432,
             "database": "discord_relay",
             "user": "discord_bot",
             "password": "your_password"
           }
         }
       }
     }
     ```
   - Update your bot configuration:
     ```json
     {
       "botName": "your-bot",
       "token": "YOUR_DISCORD_TOKEN",
       "eventHook": "https://discord.com/api/webhooks/...",
       "channelMappings": [
         {
           "channelId": "CHANNEL_ID_TO_MONITOR",
           "webhookUrl": "https://discord.com/api/webhooks/..."
         }
       ]
     }
     ```

5. **Start the Bot**
   ```bash
   # Regular start
   node app.js configs/your-bot.json
   
   # With auto-restart (recommended)
   node process-manager.js configs/your-bot.json
   ```

## Configuration Reference

### Global Settings (`settings.json`)
Contains shared configuration used by all bot instances:
- `systemHook`: Webhook for critical error notifications (invalid token, etc.)
- `database`: PostgreSQL connection settings shared by all bots

### Bot Configuration (`configs/bot-name.json`)
Each bot instance has its own configuration file:
- `botName`: Unique identifier for this bot (used as both agent and instance name)
- `token`: Discord bot/selfbot token
- `eventHook`: Webhook for member events (joins, leaves, role changes)
- `channelMappings`: Array of channel-to-webhook mappings

### Legacy Support
The system maintains backward compatibility with:
- `agentName` and `instanceName` (now combined into `botName`)
- Individual `systemHook` and `database` in bot configs (overrides global settings)

### Channel Mappings
Each mapping relays messages from a source channel to a webhook. Supports both exact channel IDs and channel name patterns:

#### By Channel ID (Legacy)
```json
{
  "channelId": "123456789",
  "webhookUrl": "https://discord.com/api/webhooks/..."
}
```

#### By Channel Name Pattern (New)
```json
{
  "guildId": "987654321",
  "channelName": "ping*",
  "webhookUrl": "https://discord.com/api/webhooks/...",
  "redactChannelName": true
}
```

#### Channel Name Redaction
Add `"redactChannelName": true` to any mapping to hide the actual channel name in relayed messages:
- **Normal**: `Username #secret-intel-channel`
- **Redacted**: `Username #[redacted]`

This is useful for sensitive channels where you want to relay content but hide the channel name for operational security.

#### Supported Channel Name Patterns
- `"general"` - Exact match (case-insensitive)
- `"ping*"` - Starts with "ping"
- `"*intel*"` - Contains "intel"
- `"*ping"` - Ends with "ping"
- `"\"exact-name\""` - Exact match with quotes for special characters

#### Everyone Catch (Mass Mention Alerts)
Monitor for @everyone, @here, or role mentions across entire guilds:
```json
{
  "everyoneCatch": [
    {
      "guildId": "987654321",
      "webhookUrl": "https://discord.com/api/webhooks/..."
    }
  ]
}
```

This feature relays messages containing mass mentions using the standard message format. Channel names are automatically redacted as `#[redacted]` for everyone catch messages to protect sensitive channel information.

## Auto-Restart System

The bot includes an intelligent auto-restart system that:

- **Always Active**: No configuration needed, always enabled
- **Smart Error Detection**: Prevents restart loops for unrecoverable errors
- **System Notifications**: Sends webhook alerts before stopping on critical errors
- **Graceful Recovery**: Properly cleans up resources before restarting

### Non-Restartable Errors
The system automatically detects and stops restarting for:
- Invalid tokens
- Missing permissions
- Unauthorized access
- Expired or revoked tokens

When these errors occur, a notification is sent to the `systemHook` before stopping.

## Performance & Monitoring

### In-Memory Cache
- Configurable RAM limits (default: 50MB)
- LRU eviction policy
- TTL-based expiration
- Automatic cleanup

### Member Synchronization
- Periodic full member sync (every 4 hours)
- Event-driven updates for real-time changes
- Batch database operations for efficiency

### Logging
- Structured console logging
- Error and activity logs in `/logs` directory
- Performance statistics tracking

## Process Management

### Using Process Manager (Recommended)
```bash
# Start with auto-restart
node process-management/process-manager.js configs/your-bot.json

# Monitor multiple instances
node process-management/instance-monitor.js
```

### Manual Start
```bash
# Basic start
node app.js configs/your-bot.json

# With custom log level
LOG_LEVEL=debug node app.js configs/your-bot.json
```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify PostgreSQL is running
   - Check credentials in config
   - Run `node utils/test-database.js` to test connection

2. **Invalid Token Errors**
   - Check if token is correct and active
   - Verify bot has necessary permissions
   - System webhook will notify of token issues

3. **Memory Issues**
   - Adjust cache limits in memory cache configuration
   - Monitor RAM usage in performance stats

### Testing

```bash
# Test database connection
node utils/test-database.js

# Test modules
node utils/test-modules.js

# Test webhook notifications
node test-webhook-notification.js
```

## Migration from Previous Versions

See `POSTGRESQL_MIGRATION_GUIDE.md` for detailed migration instructions from SQLite or Redis-based setups.

## Support

For issues, suggestions, or contributions, please open an issue on GitHub. The project includes comprehensive error handling and logging to help diagnose problems.
