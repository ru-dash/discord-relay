// Pre-compiled regex patterns for better performance
const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const MENTION_REGEX = /@(everyone|here)/g;
const USER_MENTION_REGEX = /<@!?(\d+)>/g;
const ROLE_MENTION_REGEX = /<@&(\d+)>/g;

class MessageUtils {
    /**
     * Resolve mentions in a message
     * @param {Object} message - Discord message object
     * @param {Object} cacheManager - Cache manager instance
     * @returns {string} - Message content with resolved mentions
     */
    static resolveMentions(message, cacheManager) {
        const cacheKey = `${message.guild.id}-${message.content.slice(0, 100)}`;
        
        // Check cache first
        const cached = cacheManager.getCachedMention(cacheKey);
        if (cached) {
            return cached;
        }

        // Remove zero-width characters first
        let content = MessageUtils.removeZeroWidthChars(message.content);

        content = content.replace(USER_MENTION_REGEX, (match, userId) => {
            const user = message.guild.members.cache.get(userId);
            return user ? `@${user.displayName || user.user.username}` : match;
        });

        content = content.replace(ROLE_MENTION_REGEX, (match, roleId) => {
            const role = message.guild.roles.cache.get(roleId);
            return role ? `@${role.name}` : match;
        });

        // Cache the result
        cacheManager.cacheMention(cacheKey, content);
        return content;
    }

    /**
     * Remove zero-width characters from content
     * @param {string} content - Message content
     * @returns {string} - Content with zero-width characters removed
     */
    static removeZeroWidthChars(content) {
        if (!content) return content;
        
        // Remove various zero-width characters
        // \u200B - Zero Width Space
        // \u200C - Zero Width Non-Joiner
        // \u200D - Zero Width Joiner
        // \u2060 - Word Joiner
        // \uFEFF - Zero Width No-Break Space (BOM)
        // \u061C - Arabic Letter Mark
        // \u180E - Mongolian Vowel Separator
        return content.replace(/[\u200B\u200C\u200D\u2060\uFEFF\u061C\u180E]/g, '');
    }

    /**
     * Sanitize message content
     * @param {string} content - Message content
     * @returns {string} - Sanitized content
     */
    static sanitizeMessage(content) {
        if (!content) return content;

        // First remove zero-width characters
        content = MessageUtils.removeZeroWidthChars(content);
        
        // Check if content is empty or only whitespace after removing zero-width chars
        if (!content || content.trim() === '') {
            return '[Message contained only zero-width characters]';
        }

        // Insert zero-width spaces into URLs to break hyperlinks
        content = content.replace(URL_REGEX, (url) => {
            return url.replace(/^(ht)(tp)/i, '$1\u200B$2');
        });

        // Prevent @everyone and @here mentions
        content = content.replace(MENTION_REGEX, '@\u200B$1');

        return content;
    }

    /**
     * Sanitize embeds
     * @param {Array} embeds - Array of embed objects
     * @returns {Array} - Sanitized embeds
     */
    static sanitizeEmbeds(embeds) {
        return embeds.map(embed => ({
            title: MessageUtils.sanitizeMessage(embed.title),
            description: MessageUtils.sanitizeMessage(embed.description),
            fields: embed.fields ? embed.fields.map(field => ({
                name: MessageUtils.sanitizeMessage(field.name),
                value: MessageUtils.sanitizeMessage(field.value),
                inline: field.inline
            })) : null,
            image: null, // Remove images
            thumbnail: null, // Remove thumbnails
            footer: embed.footer ? { text: MessageUtils.sanitizeMessage(embed.footer.text) } : null,
            timestamp: embed.timestamp || null
        }));
    }

    /**
     * Create message data object for database storage
     * @param {Object} message - Discord message object
     * @returns {Object} - Message data object
     */
    static createMessageData(message) {
        // Clean the content of zero-width characters for database storage
        let cleanContent = message.content;
        if (cleanContent) {
            cleanContent = MessageUtils.removeZeroWidthChars(cleanContent);
            // If content becomes empty after removing zero-width chars, store a placeholder
            if (cleanContent.trim() === '') {
                cleanContent = '[Message contained only zero-width characters]';
            }
        }

        return {
            id: message.id,
            channelId: message.channel.id,
            channelName: message.channel.name,
            guildId: message.guild.id,
            guildName: message.guild.name,
            authorId: message.author.id,
            authorDisplayName: message.member?.displayName || message.author.username,
            content: cleanContent || null,
            createdAt: message.createdTimestamp,
            updatedAt: message.editedTimestamp || null,
        };
    }

    /**
     * Create member data object for database storage
     * @param {Object} member - Discord member object
     * @param {string} channelId - Channel ID
     * @param {string} channelName - Channel name
     * @returns {Object} - Member data object
     */
    static createMemberData(member, channelId, channelName) {
        const roleNames = member.roles.cache
            .filter(role => role.name !== '@everyone')
            .map(role => role.name);

        const status = member.presence ? member.presence.status : 'offline';
        const platforms = member.presence?.clientStatus
            ? Object.entries(member.presence.clientStatus)
                .map(([platform, platformStatus]) => `${platform} (${platformStatus})`)
            : [];

        return {
            id: `${member.user.id}-${channelId}`,
            channelId: channelId,
            channelName: channelName,
            guildId: member.guild.id,
            guildName: member.guild.name,
            userId: member.user.id,
            displayName: member.displayName,
            roles: roleNames, // Now returns array instead of string
            status: status,
            platforms: platforms // Now returns array instead of string
        };
    }
}

module.exports = MessageUtils;
