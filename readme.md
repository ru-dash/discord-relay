# Discord Relay

> [!IMPORTANT]
> **This project is archived.** It has not been actively used or maintained since mid-2025, and no further updates, fixes, or support are planned. The code is left available for reference under the MIT License. It depends on libraries and Discord behaviour that may have changed since then, so expect to do some work if you want to run it today.

Discord Relay forwards messages from selected Discord channels to Discord webhooks. It runs one or more accounts as separate instances, stores messages and member data in PostgreSQL, and restarts itself after crashes.

> [!WARNING]
> This project is built on [`discord.js-selfbot-v13`](https://github.com/aiko-chan-ai/discord.js-selfbot-v13). Automating a user account violates Discord's Terms of Service and can result in the account being banned. Use it at your own risk.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running](#running)
- [Instance commands](#instance-commands)
- [Operational notes](#operational-notes)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- **Message relay** — forward messages from specific channels to webhooks, matched by channel ID or by channel name pattern.
- **Mass-mention alerts** — relay any message containing `@everyone`, `@here`, or a role mention from an entire guild.
- **Channel name redaction** — hide the source channel name in relayed messages.
- **Poll relay** — convert Discord polls into embeds showing options, vote counts, and expiry, with a link back to the original poll.
- **Event monitoring** — report member joins and leaves, role changes, and channel updates to a separate webhook.
- **PostgreSQL storage** — persist messages, channel members, instance state, and performance metrics.
- **In-memory cache** — LRU cache with a memory cap and TTL-based expiry.
- **Multi-instance management** — create, start, stop, and inspect several instances from one CLI.
- **Automatic restart** — recover from crashes, while refusing to loop on errors that cannot be fixed by restarting.
- **Live configuration reload** — pick up changes to configuration files without a restart.
- **System notifications** — send critical errors, such as an invalid token, to a system webhook.

## Requirements

- [Node.js](https://nodejs.org/) 16 or later
- PostgreSQL 12 or later

## Installation

```bash
git clone https://github.com/ru-dash/discord-relay.git
cd discord-relay
npm install
```

Create an empty PostgreSQL database and a user that owns it. The required tables are created automatically on first start.

```sql
CREATE USER discord_bot WITH PASSWORD 'your_password';
CREATE DATABASE discord_relay OWNER discord_bot;
```

## Configuration

Configuration is split into global settings shared by every instance and one file per instance.

### Global settings (`settings.json`)

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
        "password": "your_password",
        "ssl": false
      }
    }
  }
}
```

| Key | Description |
| --- | --- |
| `systemHook` | Webhook that receives critical error notifications. |
| `database.postgresql` | Connection settings used by all instances. |

### Instance configuration (`configs/<name>.json`)

Generate a template with `node instances.js create <name>`, then fill it in. The `configs/` directory is git-ignored because these files contain account tokens.

```json
{
  "botName": "my-relay",
  "token": "YOUR_DISCORD_TOKEN",
  "eventHook": "https://discord.com/api/webhooks/...",
  "channelMappings": [
    {
      "channelId": "123456789012345678",
      "webhookUrl": "https://discord.com/api/webhooks/..."
    }
  ],
  "everyoneCatch": []
}
```

| Key | Required | Description |
| --- | --- | --- |
| `botName` | No | Unique name for the instance. Defaults to `example-bot`. |
| `token` | Yes | Discord account token. |
| `eventHook` | No | Webhook for member and channel events. |
| `channelMappings` | Yes | List of channel-to-webhook mappings. |
| `everyoneCatch` | No | List of guild-wide mass-mention mappings. |

The older `agentName` and `instanceName` keys are still accepted; both are now derived from `botName`.

### Channel mappings

Map a channel by ID:

```json
{
  "channelId": "123456789012345678",
  "webhookUrl": "https://discord.com/api/webhooks/..."
}
```

Or by name pattern within a guild. `guildId` is required when `channelName` is used.

```json
{
  "guildId": "987654321098765432",
  "channelName": "ping*",
  "webhookUrl": "https://discord.com/api/webhooks/...",
  "redactChannelName": true
}
```

| Pattern | Matches |
| --- | --- |
| `general` | Exact name, case-insensitive |
| `ping*` | Names starting with `ping` |
| `*ping` | Names ending with `ping` |
| `*intel*` | Names containing `intel` |
| `"exact-name"` | Exact name, quoted for special characters |

Setting `"redactChannelName": true` replaces the channel name in relayed messages, so `Username #secret-channel` is shown as `Username #[redacted]`.

### Mass-mention alerts

```json
{
  "everyoneCatch": [
    {
      "guildId": "987654321098765432",
      "webhookUrl": "https://discord.com/api/webhooks/..."
    }
  ]
}
```

Channel names are always redacted in messages relayed this way.

## Running

Run a single instance directly:

```bash
node app.js configs/my-relay.json
```

Run it under the process manager to restart automatically after a crash:

```bash
node process-management/process-manager.js configs/my-relay.json
```

If no configuration path is given, `app.js` uses `config.json` in the project root.

## Instance commands

`instances.js` manages multiple instances. Configurations are read from `configs/` and logs are written to `logs/`.

| Command | Description |
| --- | --- |
| `node instances.js create <name>` | Create a configuration template. |
| `node instances.js start <name>` | Start an instance. |
| `node instances.js stop <name>` | Stop an instance. |
| `node instances.js restart <name>` | Restart an instance. |
| `node instances.js start-all` | Start every configured instance. |
| `node instances.js stop-all` | Stop every running instance. |
| `node instances.js list` | List instances and their status. |
| `node instances.js logs <name>` | Show the last 50 log lines for an instance. |
| `node instances.js config <name>` | Show the configuration path for an instance. |
| `node instances.js fetch-reactions <name> <message-id> [channel-id]` | Fetch the reactions on a message. |
| `node instances.js fetch-channels <name> [guild-id\|guild-name] [--no-perms]` | List guilds and channels with access status. |
| `node instances.js search-user <name> <discord-id>` | Search for a user across all guilds. |

Several of these are also available as npm scripts, including `npm run start-all`, `npm run stop-all`, and `npm run status`.

## Operational notes

**Automatic restart.** The process manager restarts an instance after a crash, but stops and notifies `systemHook` when the cause cannot be resolved by restarting: an invalid, expired, or revoked token, missing permissions, or unauthorized access.

**Automatic updates.** A running instance checks this repository's GitHub releases hourly and installs newer versions automatically. This cannot be turned off through configuration. As the project is archived, no further releases are expected.

**Caching.** The in-memory cache is limited to 50 MB by default and evicts the least recently used entries first.

**Command files.** Instance commands communicate with running instances through temporary files in `commands/`. Run `npm run cleanup` to remove stale ones, or `npm run cleanup-dry-run` to preview what would be removed.

## Project structure

```
app.js                     Entry point for a single instance
instances.js               Multi-instance management CLI
cleanup-commands.js        Removes stale command files
process-management/        Process manager, background launcher, instance monitor
src/
  cache/                   In-memory cache
  config/                  Configuration loading, validation, and live reload
  database/                PostgreSQL storage
  handlers/                Message, system event, member, and command handling
  instance/                Instance lifecycle and status tracking
  utils/                   Auto-updater, shutdown, performance, message helpers
  webhook/                 Webhook delivery and embed formatting
```

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Database connection errors | PostgreSQL is running, the database and user exist, and the credentials in `settings.json` are correct. |
| Invalid token errors | The token is current. The instance stops and reports the error to `systemHook` rather than restarting. |
| Messages are not relayed | The account can see the channel, and the mapping's `channelId` or `guildId` and `channelName` are correct. `fetch-channels` shows what the account can access. |
| An instance will not start | `node instances.js logs <name>` and the error log in `logs/`. |

## License

Released under the [MIT License](LICENSE).
