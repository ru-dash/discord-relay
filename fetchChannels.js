require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// Load config
const fs = require('fs');
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
    console.error('Config file not found! Please ensure config.json exists.');
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath));

// Ensure the token is provided
if (!config.token) {
    console.error('No token found in the config file.');
    process.exit(1);
}

// Generate a random username and password for the challenge
const randomUsername = crypto.randomBytes(4).toString('hex');
const randomPassword = crypto.randomBytes(8).toString('hex');
console.log(`Challenge Username: ${randomUsername}`);
console.log(`Challenge Password: ${randomPassword}`);

// Create a client instance
const client = new Client({
    checkUpdate: false,
    ws: { properties: { browser: "Discord Client", os: "Windows", device: "desktop" } },
});

// Express server to serve UI
const app = express();
const PORT = Math.floor(1024 + Math.random() * 64511); // Random available port between 1024 and 65535

// Serve static files for UI
app.use(require('express-basic-auth')({ users: { [randomUsername]: randomPassword }, challenge: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to fetch data
app.get('/api/guilds', async (req, res) => {
    try {
        const guildData = await fetchGuildData();
        res.json(guildData);
    } catch (error) {
        console.error('Error fetching guild data:', error);
        res.status(500).json({ error: 'Failed to fetch guild data' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Fetch guild and channel data
const fetchGuildData = async () => {
    const data = [];
    for (const [guildId, guild] of client.guilds.cache) {
        const categories = guild.channels.cache
            .filter(channel => channel.type === 'GUILD_CATEGORY')
            .sort((a, b) => a.rawPosition - b.rawPosition);

        const channels = guild.channels.cache
            .filter(channel => ['GUILD_TEXT', 'GUILD_NEWS'].includes(channel.type))
            .sort((a, b) => a.rawPosition - b.rawPosition);

        const guildInfo = {
            name: guild.name,
            id: guild.id,
            categories: [],
            uncategorized: []
        };

        categories.forEach(category => {
            const categoryChannels = channels.filter(channel => channel.parentId === category.id);
            guildInfo.categories.push({
                name: category.name,
                id: category.id,
                channels: categoryChannels.map(channel => ({
                    name: channel.name,
                    id: channel.id,
                    viewable: channel.viewable,
                    lastMessageId: channel.lastMessageId || 'No messages',
                }))
            });
        });

        const uncategorizedChannels = channels.filter(channel => !channel.parentId);
        guildInfo.uncategorized = uncategorizedChannels.map(channel => ({
            name: channel.name,
            id: channel.id,
            viewable: channel.viewable,
            lastMessageId: channel.lastMessageId || 'No messages',
        }));

        data.push(guildInfo);
    }
    return data;
};

// Login to Discord
console.log('Attempting to log in...');
client.login(config.token).catch((error) => {
    console.error(`Login failed: ${error.message}`);
});

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create the public folder with UI files
if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'));
}

// Generate UI HTML
fs.writeFileSync(
    path.join(__dirname, 'public', 'index.html'),
    `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Discord Guild Viewer</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background: #f4f4f9;
        }
        .guild, .category, .uncategorized {
            margin: 10px;
        }
        .dropdown {
            cursor: pointer;
            background: #007bff;
            color: white;
            padding: 10px;
            border: none;
            border-radius: 5px;
            width: 100%;
            text-align: left;
        }
        .dropdown:hover {
            background: #0056b3;
        }
        .dropdown + .content {
            display: none;
            margin-top: 10px;
            padding-left: 20px;
            background: #fff;
            border-left: 4px solid #007bff;
            border-radius: 5px;
        }
        .content.visible {
            display: block;
        }
        .channel {
            margin-left: 20px;
            padding: 5px 0;
        }
    </style>
</head>
<body>
    <div id="content"></div>
    <script>
        async function fetchGuildData() {
            const response = await fetch('/api/guilds');
            const data = await response.json();
            renderGuilds(data);
        }

        function renderGuilds(guilds) {
            const content = document.getElementById('content');
            content.innerHTML = '';
            guilds.forEach(guild => {
                const guildDiv = document.createElement('div');
                guildDiv.className = 'guild';
                guildDiv.innerHTML = \`<button class="dropdown">\${guild.name} (ID: \${guild.id})</button>\`;

                const guildContent = document.createElement('div');
                guildContent.className = 'content';

                guild.categories.forEach(category => {
                    const categoryDiv = document.createElement('div');
                    categoryDiv.className = 'category';
                    categoryDiv.innerHTML = \`<button class="dropdown">Category: \${category.name}</button>\`;

                    const categoryContent = document.createElement('div');
                    categoryContent.className = 'content';

                    category.channels.forEach(channel => {
                        const channelDiv = document.createElement('div');
                        channelDiv.className = 'channel';
                        channelDiv.innerHTML = \`
                            #\${channel.name} (ID: \${channel.id})<br>
                            Viewable: \${channel.viewable ? 'Yes' : 'No'}<br>
                            Last Message ID: \${channel.lastMessageId} (\${new Date().toLocaleString()})
                        \`;
                        categoryContent.appendChild(channelDiv);
                    });

                    categoryDiv.appendChild(categoryContent);
                    guildContent.appendChild(categoryDiv);
                });

                if (guild.uncategorized.length > 0) {
                    const uncategorizedDiv = document.createElement('div');
                    uncategorizedDiv.className = 'uncategorized';
                    uncategorizedDiv.innerHTML = '<button class="dropdown">No Category</button>';

                    const uncategorizedContent = document.createElement('div');
                    uncategorizedContent.className = 'content';

                    guild.uncategorized.forEach(channel => {
                        const channelDiv = document.createElement('div');
                        channelDiv.className = 'channel';
                        channelDiv.innerHTML = \`
                            #\${channel.name} (ID: \${channel.id})<br>
                            Viewable: \${channel.viewable ? 'Yes' : 'No'}<br>
                            Last Message ID: \${channel.lastMessageId}
                        \`;
                        uncategorizedContent.appendChild(channelDiv);
                    });

                    uncategorizedDiv.appendChild(uncategorizedContent);
                    guildContent.appendChild(uncategorizedDiv);
                }

                guildDiv.appendChild(guildContent);
                content.appendChild(guildDiv);
            });

            // Add toggle functionality to dropdowns
            document.querySelectorAll('.dropdown').forEach(button => {
                button.addEventListener('click', () => {
                    const content = button.nextElementSibling;
                    content.classList.toggle('visible');
                });
            });
        }

        fetchGuildData();
    </script>
</body>
</html>
`
);