require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const configPath = process.argv[2] || path.join(__dirname, 'config.json'); // Use a default path if no argument is provided
let config = { token: '', channelMappings: [] };

// Load config
const defaultConfig = { token: '', channelMappings: [] };

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
});

// Listen for message updates
client.on('messageUpdate', (oldMessage, newMessage) => {
    if (messageMappings[oldMessage.id]) {
        sendToWebhook(newMessage, true);
        console.log(`Updated message sent to webhook for channel: ${oldMessage.channel.id}`);
    } else {
        console.log(`No mapping found for message ID: ${oldMessage.id}, cannot update.`);
    }
});

// Start the bot
console.log('Attempting to log in...');
try {
    client.login(config.token).catch((error) => {
        console.error(`Login failed: ${error.message}`);
    });
} catch (error) {
    console.error(`Error starting bot: ${error.message}`);
}