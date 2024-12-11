require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const sqlite3 = require('sqlite3').verbose();

const configPath = process.argv[2] || path.join(__dirname, 'config.json'); // Use a default path if no argument is provided
let config = { token: '', channelMappings: [] };

// Load config
const defaultConfig = { token: '', channelMappings: [] };

// Initialize SQLite Database
const db = new sqlite3.Database('./messages.db', (err) => {
    if (err) {
        console.error('Error connecting to SQLite:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// Create table for messages
db.run(
    `CREATE TABLE IF NOT EXISTS messages (
                                             id TEXT PRIMARY KEY,
                                             channelId TEXT,
                                             channelName TEXT,
                                             guildId TEXT,
                                             guildName TEXT,
                                             authorId TEXT,
                                             authorDisplayName TEXT,
                                             content TEXT,
                                             createdAt TEXT,
                                             updatedAt TEXT
     )`,
    (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        } else {
            console.log('Messages table ensured.');
        }
    }
);

db.run(
    `CREATE TABLE IF NOT EXISTS channel_members (
                                                    id TEXT PRIMARY KEY,
                                                    channelId TEXT,
                                                    channelName TEXT,
                                                    guildId TEXT,
                                                    guildName TEXT,
                                                    userId TEXT,
                                                    displayName TEXT,
                                                    roles TEXT,
                                                    status TEXT,
                                                    platforms TEXT
     )`,
    (err) => {
        if (err) {
            console.error('Error creating table:', err.message);
        } else {
            console.log('Channel members table ensured.');
        }
    }
);

function isRelayedGuild(guildId) {
    // Check if any channel in the webhook map belongs to the given guild
    return Object.keys(channelWebhookMap).some(channelId => {
        const channel = client.channels.cache.get(channelId);
        return channel && channel.guild.id === guildId;
    });
}

// Function to save message to SQLite
function saveMessageToDB(message) {
    if (!message.guild || !isRelayedGuild(message.guild.id)) return;

    const guildName = message.guild.name;
    const channelName = message.channel.name;
    const authorDisplayName = message.member ? message.member.displayName : message.author.username;

    const sql = `INSERT INTO messages (id, channelId, channelName, guildId, guildName, authorId, authorDisplayName, content, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(id) 
                 DO UPDATE SET
        content = excluded.content,
                                             updatedAt = excluded.updatedAt,
                                             guildName = excluded.guildName,
                                             channelName = excluded.channelName,
                                             authorDisplayName = excluded.authorDisplayName`;

    const params = [
        message.id,
        message.channel.id,
        channelName,
        message.guild.id,
        guildName,
        message.author.id,
        authorDisplayName,
        message.content || null,
        message.createdTimestamp,
        message.editedTimestamp || null,
    ];

    db.run(sql, params, (err) => {
        if (err) {
            console.error('Error saving message to SQLite:', err.message);
        } else {
            console.log(`Message ${message.id} saved/updated in SQLite.`);
        }
    });
}

if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log('Config file generated. Please fill in the details.');
    process.exit(0);
} else {
    try {
        const configFileContent = fs.readFileSync(configPath);
        config = JSON.parse(configFileContent);
    } catch (error) {
        console.error('Failed to read or parse config file:', error.message);
        process.exit(1);
    }
}

const client = new Client({
    checkUpdate: false,
    ws: { properties: { browser: "Discord Client", os: "Windows", device: "desktop" } }
});

// Map channel IDs to webhook URLs
const channelWebhookMap = {};
config.channelMappings.forEach(mapping => {
    channelWebhookMap[mapping.channelId] = mapping.webhookUrl;
});

// Store message mappings (Discord message ID to Webhook message ID)
const messageMappings = {};

// Sanitize messages
function sanitizeMessage(content) {
    if (!content) return content;

    // Insert zero-width spaces into URLs to break hyperlinks
    content = content.replace(/(https?:\/\/[^\s]+)/g, (url) => {
        return url.split('').join('\u200B'); // Break URLs with zero-width spaces
    });

    // Prevent @everyone and @here mentions
    content = content.replace(/@(everyone|here)/g, '@\u200B$1');

    return content;
}

const resolveMentions = (message) => {
    const userMentionRegex = /<@!?(\d+)>/g;
    let content = message.content.replace(userMentionRegex, (match, userId) => {
        const user = message.guild.members.cache.get(userId);
        return user ? `@${user.displayName || user.user.username}` : match;
    });

    const roleMentionRegex = /<@&(\d+)>/g;
    content = content.replace(roleMentionRegex, (match, roleId) => {
        const role = message.guild.roles.cache.get(roleId);
        return role ? `@${role.name}` : match;
    });

    return content;
};

// Sanitize embeds
function sanitizeEmbeds(embeds) {
    return embeds.map(embed => ({
        title: embed.title,
        description: sanitizeMessage(embed.description),
        fields: embed.fields ? embed.fields.map(field => ({
            name: sanitizeMessage(field.name),
            value: sanitizeMessage(field.value),
            inline: field.inline
        })) : null,
        image: null, // Remove images
        thumbnail: null, // Remove thumbnails
        footer: embed.footer ? { text: sanitizeMessage(embed.footer.text) } : null,
        timestamp: embed.timestamp || null
    }));
}

const sendToWebhook = async (message, isUpdate = false) => {
    const channelId = message.channel.id;
    const webhookUrl = channelWebhookMap[channelId];

    if (!webhookUrl) {
        console.log(`No webhook URL mapped for channel ID: ${channelId}`);
        return;
    }

    const displayName = message.member ? message.member.displayName : message.author.username;
    const sanitizedContent = sanitizeMessage(resolveMentions(message)); // Resolve and sanitize message content

    const messageData = {
        username: displayName + " #" + message.channel.name,
        content: sanitizedContent,
        avatar_url: message.author.displayAvatarURL(),
        embeds: sanitizeEmbeds(message.embeds),
    };

    let form = new FormData();
    form.append('payload_json', JSON.stringify(messageData));

    if (message.attachments.size > 0) {
        for (const [key, attachment] of message.attachments) {
            try {
                const response = await axios.get(attachment.url, { responseType: 'stream' });
                form.append(`file${key}`, response.data, {
                    filename: attachment.name,
                    contentType: response.headers['content-type'],
                });
            } catch (error) {
                console.error(`Error fetching attachment: ${error.message}`);
            }
        }
    }

    try {
        let response;
        if (isUpdate && messageMappings[message.id]) {
            const url = `${webhookUrl}/messages/${messageMappings[message.id]}`;
            response = await axios.patch(url, form, {
                headers: {
                    ...form.getHeaders(),
                }
            });
        } else if (!isUpdate) {
            const urlWithWait = `${webhookUrl}?wait=true`;
            response = await axios.post(urlWithWait, form, {
                headers: {
                    ...form.getHeaders(),
                }
            });

            if (response.data && response.data.id) {
                messageMappings[message.id] = response.data.id;
            }
        }
    } catch (error) {
        console.error(`Error sending message to webhook: ${error.message}`);
    }
};

// Listen for new messages
client.on('messageCreate', message => {
    if (message.flags && message.flags.has('EPHEMERAL')) {
        console.log(`Ephemeral: ${message.channel.id}`);
        return;
    }
    sendToWebhook(message);
    console.log(`New message sent to webhook for channel: ${message.channel.id}`);

    if (!message.guild) return; // Ignore DMs and bot messages
    saveMessageToDB(message);
});

// Listen for message updates
client.on('messageUpdate', (oldMessage, newMessage) => {
    if (messageMappings[oldMessage.id]) {
        sendToWebhook(newMessage, true);
        console.log(`Updated message sent to webhook for channel: ${oldMessage.channel.id}`);
    } else {
        console.log(`No mapping found for message ID: ${oldMessage.id}, cannot update.`);
    }
    if (!newMessage.guild) return; // Ignore DMs and bot messages
    saveMessageToDB(newMessage);
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Lazy load members for all relayed channels
    config.channelMappings.forEach(mapping => {
        fetchAndSaveChannelMembers(mapping.channelId);
    });
});

async function fetchAndSaveChannelMembers(channelId) {
    const channel = client.channels.cache.get(channelId);

    // Check if the channel is valid and text-based
    if (!channel || (channel.type !== 'GUILD_TEXT' && channel.type !== 'GUILD_NEWS')) {
        console.error(`Channel with ID ${channelId} is not a valid text-based channel.`);
        return;
    }

    const guild = channel.guild;

    try {
        // Fetch all members in the guild
        const members = await guild.members.fetch();

        members.forEach(member => {
            const roleNames = member.roles.cache
                .filter(role => role.name !== '@everyone') // Exclude the default role
                .map(role => role.name)
                .join(', '); // Join role names with a comma

            const status = member.presence ? member.presence.status : 'offline';
            const platforms = member.presence?.clientStatus
                ? Object.entries(member.presence.clientStatus)
                    .map(([platform, platformStatus]) => `${platform} (${platformStatus})`)
                    .join(', ')
                : 'No platforms';

            const sql = `INSERT INTO channel_members (id, channelId, channelName, guildId, guildName, userId, displayName, roles, status, platforms)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(id)
                         DO UPDATE SET
                displayName = excluded.displayName,
                                                             roles = excluded.roles,
                                                             status = excluded.status,
                                                             platforms = excluded.platforms`;

            const params = [
                `${member.user.id}-${channelId}`, // Unique ID per user per channel
                channelId,
                channel.name,
                guild.id,
                guild.name,
                member.user.id,
                member.displayName,
                roleNames || 'None',
                status,
                platforms
            ];

            db.run(sql, params, (err) => {
                if (err) {
                    console.error('Error saving channel member to SQLite:', err.message);
                } else {
                    console.log(`Member ${member.user.id} saved/updated in SQLite for channel ${channel.name}.`);
                }
            });
        });
    } catch (error) {
        console.error(`Error fetching members for channel '${channel.name}': ${error.message}`);
    }
}

const sendSystemNotification = async (guild, title, description, fields = []) => {
    const systemHook = config.systemHook;

    color = {
        "Guild Joined" : 894976,
        "Guild Left" : 11010048,
        "Channel Updated" : 22696,
        "Role Update" : 14680319,
    }

    if (!systemHook) {
        console.warn('SystemHook not configured in the config file.');
        return;
    }

    const embed = {
        color: color[title],
        author: {name: guild.name, icon_url: guild.iconURL(false)},
        title: title,
        description: description,
        fields: fields,
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(systemHook, {
            embeds: [embed]
        });
        console.log('System notification sent:', title);
    } catch (error) {
        console.error('Error sending system notification:', error.message);
    }
};

const sendEventNotification = async (guild, action, description) => {
    const eventHook = config.eventHook;

    color = {
        "Event Created" : 14075136,
        "Event Deleted" : 12483072,
        "Event Updated" : 14075136,
    }

    if (!eventHook) {
        console.warn('EventHook not configured in the config file.');
        return;
    }

    const embed = {
        color: color[action],
        author: {name: guild.name, icon_url: guild.iconURL(false)},
        title: action,
        description: description,
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(eventHook, {
            embeds: [embed]
        });
        console.log('Event notification sent:', title);
    } catch (error) {
        console.error('Error sending event notification:', error.message);
    }

}

client.on('guildMemberUpdate', (oldMember, newMember) => {
    // Check if the update is for the self-bot
    if (newMember.user.id !== client.user.id) return;

    // Compare roles
    if (!oldMember.roles.cache.equals(newMember.roles.cache)) {
        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

        let fields = [];
        if (addedRoles.size > 0) {
            fields.push({ name: 'Added Roles', value: addedRoles.map(role => role.name).join(', '), inline: true });
        }
        if (removedRoles.size > 0) {
            fields.push({ name: 'Removed Roles', value: removedRoles.map(role => role.name).join(', '), inline: true });
        }

        // Send a system notification with the role changes
        sendSystemNotification(
            newMember.guild,
            'Role Update',
            `Roles for **${config.agentName || client.user.username}** were updated in guild **${newMember.guild.name}**.`,
            fields
        );
    }
});

client.on('guildCreate', (guild) => {
    sendSystemNotification(
        guild,
        'Guild Joined',
        `**${config.agentName}** has joined the guild **${guild.name}** (ID: ${guild.id}).`
    );
});

client.on('guildDelete', (guild) => {
    sendSystemNotification(
        guild,
        'Guild Left',
        `**${config.agentName}** has left the guild **${guild.name}** (ID: ${guild.id}).`
    );
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    // Ensure the guild is being relayed
    if (!isRelayedGuild(newChannel.guild.id)) return;

    const guild = newChannel.guild;
    const fields = [];

    // Compare permission overwrites
    const oldPermissions = oldChannel.permissionOverwrites.cache;
    const newPermissions = newChannel.permissionOverwrites.cache;

    if (!oldPermissions.equals(newPermissions)) {
        const addedPermissions = newPermissions.filter(
            overwrite => !oldPermissions.has(overwrite.id)
        );
        const removedPermissions = oldPermissions.filter(
            overwrite => !newPermissions.has(overwrite.id)
        );

        if (addedPermissions.size > 0) {
            const added = await Promise.all(
                addedPermissions.map(async (overwrite) => {
                    if (overwrite.type === 'role') {
                        const role = guild.roles.cache.get(overwrite.id) || await guild.roles.fetch(overwrite.id);
                        return `Role: ${role ? role.name : `Unknown (${overwrite.id})`}`;
                    } else if (overwrite.type === 'member') {
                        const member = guild.members.cache.get(overwrite.id) || await guild.members.fetch(overwrite.id).catch(() => null);
                        return `User: ${member ? member.displayName : `Unknown (${overwrite.id})`}`;
                    }
                })
            );
            fields.push({
                name: 'Added Permissions',
                value: added.filter(Boolean).join('\n'),
                inline: false
            });
        }

        if (removedPermissions.size > 0) {
            const removed = await Promise.all(
                removedPermissions.map(async (overwrite) => {
                    if (overwrite.type === 'role') {
                        const role = guild.roles.cache.get(overwrite.id) || await guild.roles.fetch(overwrite.id);
                        return `Role: ${role ? role.name : `Unknown (${overwrite.id})`}`;
                    } else if (overwrite.type === 'member') {
                        const member = guild.members.cache.get(overwrite.id) || await guild.members.fetch(overwrite.id).catch(() => null);
                        return `User: ${member ? member.displayName : `Unknown (${overwrite.id})`}`;
                    }
                })
            );
            fields.push({
                name: 'Removed Permissions',
                value: removed.filter(Boolean).join('\n'),
                inline: false
            });
        }
    }

    // Check for viewable status changes
    const wasViewable = oldChannel.viewable;
    const isViewable = newChannel.viewable;

    fields.push({
        name: 'Viewable Status',
        value: `**Before:** ${wasViewable ? 'Yes' : 'No'}\n**After:** ${isViewable ? 'Yes' : 'No'}`,
        inline: false
    });

    // If there are changes, send a notification
    if (fields.length > 1) { // At least one change + viewable status
        sendSystemNotification(
            guild,
            'Channel Updated',
            `Channel **${newChannel.name}** in guild **${guild.name}** was updated.`,
            fields
        );
    }
});

// fire when a Event is created
client.on("guildScheduledEventCreate", (guildEvent) => {
    if (!isRelayedGuild(guildEvent.guild.id)) return;
    sendEventNotification(
        guildEvent.guild,
        "Event Created",
        `Event *${guildEvent.name}* was scheduled for ${guildEvent.scheduledStartAt} \n Description: ${guildEvent.description}`
    )
})

// fire when a Event is deleted
client.on("guildScheduledEventDelete", (guildEvent) => {
    if (!isRelayedGuild(guildEvent.guild.id)) return;
    sendEventNotification(
        guildEvent.guild,
        "Event Deleted",
        `Event *${guildEvent.name}* was deleted`
    )
})

// fire when a Event is deleted
client.on("guildScheduledEventUpdate", (oldguildEvent, newguildEvent) => {
    if (!isRelayedGuild(oldguildEvent.guild.id)) return;
    changes = []

    if (oldguildEvent.name != newguildEvent.name) changes.push(`\n**Title** changed to ${newguildEvent.name}`);
    if (oldguildEvent.description != newguildEvent.description) changes.push(`\n**Description** changed to ${newguildEvent.description}`);
    if (oldguildEvent.scheduledStartTimestamp != newguildEvent.scheduledStartTimestamp) changes.push(`\n**Starttime** changed to ${newguildEvent.scheduledStartAt}`);


    sendEventNotification(
        newguildEvent.guild,
        "Event Updated",
        `Event *${oldguildEvent.name}* was updated: ${changes}`
    )
})

// Start the bot
console.log('Attempting to log in...');
try {
    client.login(config.token).catch((error) => {
        console.error(`Login failed: ${error.message}`);
    });
} catch (error) {
    console.error(`Error starting bot: ${error.message}`);
}