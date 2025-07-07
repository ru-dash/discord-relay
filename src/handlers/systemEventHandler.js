class SystemEventHandler {
    constructor(axiosInstance, config) {
        this.axiosInstance = axiosInstance;
        this.config = config;
        
        // Color constants for better performance
        this.SYSTEM_COLORS = {
            "Guild Joined": 894976,
            "Guild Left": 11010048,
            "Channel Updated": 22696,
            "Role Update": 14680319,
        };

        this.EVENT_COLORS = {
            "Event Created": 14075136,
            "Event Deleted": 12483072,
            "Event Updated": 14075136,
        };
    }

    /**
     * Send system notification
     * @param {Object} guild - Discord guild object
     * @param {string} title - Notification title
     * @param {string} description - Notification description
     * @param {Array} fields - Embed fields
     */
    async sendSystemNotification(guild, title, description, fields = []) {
        const systemHook = this.config.systemHook;

        if (!systemHook) {
            console.warn('SystemHook not configured in the config file.');
            return;
        }

        const embed = {
            color: this.SYSTEM_COLORS[title],
            author: {name: guild.name, icon_url: guild.iconURL(false)},
            title: title,
            description: description,
            fields: fields,
            timestamp: new Date().toISOString(),
        };

        try {
            await this.axiosInstance.post(systemHook, {
                embeds: [embed]
            });
            console.log('System notification sent:', title);
        } catch (error) {
            console.error('Error sending system notification:', error.message);
        }
    }

    /**
     * Send event notification
     * @param {Object} guild - Discord guild object
     * @param {string} action - Event action
     * @param {string} description - Event description
     */
    async sendEventNotification(guild, action, description) {
        const eventHook = this.config.eventHook;

        if (!eventHook) {
            console.warn('EventHook not configured in the config file.');
            return;
        }

        const embed = {
            color: this.EVENT_COLORS[action],
            author: {name: guild.name, icon_url: guild.iconURL(false)},
            title: action,
            description: description,
            timestamp: new Date().toISOString(),
        };

        try {
            await this.axiosInstance.post(eventHook, {
                embeds: [embed]
            });
            console.log('Event notification sent:', action);
        } catch (error) {
            console.error('Error sending event notification:', error.message);
        }
    }

    /**
     * Handle guild member update (role changes)
     * @param {Object} oldMember - Old member object
     * @param {Object} newMember - New member object
     * @param {Object} client - Discord client
     */
    handleGuildMemberUpdate(oldMember, newMember, client) {
        // Check if the update is for the self-bot
        if (newMember.user.id !== client.user.id) return;

        // Compare roles
        if (!oldMember.roles.cache.equals(newMember.roles.cache)) {
            const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
            const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

            let fields = [];
            if (addedRoles.size > 0) {
                fields.push({ 
                    name: 'Added Roles', 
                    value: addedRoles.map(role => role.name).join(', '), 
                    inline: true 
                });
            }
            if (removedRoles.size > 0) {
                fields.push({ 
                    name: 'Removed Roles', 
                    value: removedRoles.map(role => role.name).join(', '), 
                    inline: true 
                });
            }

            // Send a system notification with the role changes
            this.sendSystemNotification(
                newMember.guild,
                'Role Update',
                `Roles for **${this.config.agentName || client.user.username}** were updated in guild **${newMember.guild.name}**.`,
                fields
            );
        }
    }

    /**
     * Handle guild create (bot joined guild)
     * @param {Object} guild - Discord guild object
     */
    handleGuildCreate(guild) {
        this.sendSystemNotification(
            guild,
            'Guild Joined',
            `**${this.config.agentName}** has joined the guild **${guild.name}** (ID: ${guild.id}).`
        );
    }

    /**
     * Handle guild delete (bot left guild)
     * @param {Object} guild - Discord guild object
     */
    handleGuildDelete(guild) {
        this.sendSystemNotification(
            guild,
            'Guild Left',
            `**${this.config.agentName}** has left the guild **${guild.name}** (ID: ${guild.id}).`
        );
    }

    /**
     * Handle channel update
     * @param {Object} oldChannel - Old channel object
     * @param {Object} newChannel - New channel object
     * @param {Function} isRelayedGuild - Function to check if guild is relayed
     */
    async handleChannelUpdate(oldChannel, newChannel, isRelayedGuild) {
        // Ensure the guild is being relayed
        if (!newChannel.guild) {
            console.warn(`channelUpdate: newChannel.guild is undefined (channel ID: ${newChannel.id})`);
            return;
        }
        
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
            this.sendSystemNotification(
                guild,
                'Channel Updated',
                `Channel **${newChannel.name}** in guild **${guild.name}** was updated.`,
                fields
            );
        }
    }

    /**
     * Handle scheduled event create
     * @param {Object} guildEvent - Discord guild event object
     * @param {Function} isRelayedGuild - Function to check if guild is relayed
     */
    handleGuildScheduledEventCreate(guildEvent, isRelayedGuild) {
        if (!isRelayedGuild(guildEvent.guild.id)) return;
        this.sendEventNotification(
            guildEvent.guild,
            "Event Created",
            `Event *${guildEvent.name}* was scheduled for ${guildEvent.scheduledStartAt} \n Description: ${guildEvent.description}`
        );
    }

    /**
     * Handle scheduled event delete
     * @param {Object} guildEvent - Discord guild event object
     * @param {Function} isRelayedGuild - Function to check if guild is relayed
     */
    handleGuildScheduledEventDelete(guildEvent, isRelayedGuild) {
        if (!isRelayedGuild(guildEvent.guild.id)) return;
        this.sendEventNotification(
            guildEvent.guild,
            "Event Deleted",
            `Event *${guildEvent.name}* was deleted`
        );
    }

    /**
     * Handle scheduled event update
     * @param {Object} oldGuildEvent - Old guild event object
     * @param {Object} newGuildEvent - New guild event object
     * @param {Function} isRelayedGuild - Function to check if guild is relayed
     */
    handleGuildScheduledEventUpdate(oldGuildEvent, newGuildEvent, isRelayedGuild) {
        if (!isRelayedGuild(oldGuildEvent.guild.id)) return;
        const changes = [];

        if (oldGuildEvent.name !== newGuildEvent.name) {
            changes.push(`\n**Title** changed to ${newGuildEvent.name}`);
        }
        if (oldGuildEvent.description !== newGuildEvent.description) {
            changes.push(`\n**Description** changed to ${newGuildEvent.description}`);
        }
        if (oldGuildEvent.scheduledStartTimestamp !== newGuildEvent.scheduledStartTimestamp) {
            changes.push(`\n**Starttime** changed to ${newGuildEvent.scheduledStartAt}`);
        }

        this.sendEventNotification(
            newGuildEvent.guild,
            "Event Updated",
            `Event *${oldGuildEvent.name}* was updated: ${changes.join('')}`
        );
    }
}

module.exports = SystemEventHandler;
