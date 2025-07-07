const MessageUtils = require('../utils/messageUtils');

class MemberManager {
    constructor(databaseManager) {
        this.databaseManager = databaseManager;
    }

    /**
     * Fetch and save channel members to database
     * @param {string} channelId - Channel ID
     * @param {Object} client - Discord client
     * @param {boolean} isPeriodicSync - Whether this is a periodic sync (for logging)
     */
    async fetchAndSaveChannelMembers(channelId, client, isPeriodicSync = false) {
        const channel = client.channels.cache.get(channelId);

        // Check if the channel is valid and text-based
        if (!channel || (channel.type !== 'GUILD_TEXT' && channel.type !== 'GUILD_NEWS')) {
            console.error(`Channel with ID ${channelId} is not a valid text-based channel.`);
            return;
        }

        const guild = channel.guild;
        const syncType = isPeriodicSync ? 'periodic sync' : 'initial fetch';

        try {
            const startTime = Date.now();
            
            // Fetch all members in the guild
            const members = await guild.members.fetch();
            const memberBatch = [];

            members.forEach(member => {
                const memberData = MessageUtils.createMemberData(member, channelId, channel.name);
                memberBatch.push(memberData);
            });

            // Batch insert all members
            if (memberBatch.length > 0) {
                await this.databaseManager.saveMemberBatch(memberBatch);
                
                const duration = Date.now() - startTime;
                console.log(`[${syncType}] Saved ${memberBatch.length} members for channel '${channel.name}' in ${duration}ms`);
            } else {
                console.log(`[${syncType}] No members found for channel '${channel.name}'`);
            }
        } catch (error) {
            console.error(`Error fetching members for channel '${channel.name}' (${syncType}): ${error.message}`);
            throw error; // Re-throw for periodic sync error handling
        }
    }

    /**
     * Populate relayed guild IDs cache
     * @param {Object} client - Discord client
     * @param {Map} channelWebhookMap - Channel webhook mappings
     * @param {Object} cacheManager - Cache manager instance
     */
    populateRelayedGuildIds(client, channelWebhookMap, cacheManager) {
        cacheManager.clearRelayedGuilds();
        
        Array.from(channelWebhookMap.keys()).forEach(channelId => {
            const channel = client.channels.cache.get(channelId);
            if (channel && channel.guild) {
                cacheManager.addRelayedGuild(channel.guild.id);
                console.log(`Added guild ${channel.guild.name} (${channel.guild.id}) to relayed guilds`);
            } else {
                console.warn(`Channel ${channelId} not found or has no guild`);
            }
        });
        
        console.log(`Populated ${cacheManager.getCacheSizes().relayedGuilds} relayed guild IDs`);
    }
}

module.exports = MemberManager;
