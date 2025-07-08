const { Pool } = require('pg');

class DatabaseManager {
    constructor(config = {}) {
        // PostgreSQL configuration
        this.pgConfig = {
            host: config.pg?.host || 'localhost',
            port: config.pg?.port || 5432,
            database: config.pg?.database || 'discord_relay',
            user: config.pg?.user || 'discord_bot',
            password: config.pg?.password || 'your_password',
            ssl: config.pg?.ssl || false,
            max: 20, // Connection pool size
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        };

        this.instanceName = config.instanceName || 'default';
        this.pgPool = null;
        this.performanceStats = null;

        // Batching configuration
        this.BATCH_SIZE = 100;
        this.BATCH_TIMEOUT = 3000;
        this.pendingMessageBatch = [];
        this.pendingMemberBatch = [];
        this.messageBatchTimeout = null;
        this.memberBatchTimeout = null;
    }

    /**
     * Initialize with cache manager for caching support
     * @param {Object} performanceStats - Performance statistics object
     * @param {Object} cacheManager - Cache manager instance
     * @returns {Promise<void>}
     */
    async initialize(performanceStats, cacheManager = null) {
        this.performanceStats = performanceStats;
        this.cacheManager = cacheManager;
        
        if (this.cacheManager) {
            this.cacheManager.setInstanceName(this.instanceName);
        }
        
        try {
            // Initialize PostgreSQL (Primary Database)
            await this.initializePostgreSQL();
            
            console.log(`[${this.instanceName}] Database initialized successfully${this.cacheManager ? ' with memory cache' : ''}`);
        } catch (error) {
            console.error(`[${this.instanceName}] Failed to initialize database:`, error.message);
            throw error;
        }
    }

    /**
     * Initialize PostgreSQL connection and create tables
     * @returns {Promise<void>}
     */
    async initializePostgreSQL() {
        this.pgPool = new Pool(this.pgConfig);
        
        // Test connection
        const client = await this.pgPool.connect();
        console.log(`[${this.instanceName}] Connected to PostgreSQL database`);
        client.release();

        // Create tables if they don't exist
        await this.createPostgreSQLTables();
        await this.updatePostgreSQLTables(); // Update existing tables with new columns
        await this.createPostgreSQLIndexes();
        
        console.log(`[${this.instanceName}] PostgreSQL tables and indexes ensured`);
    }

    /**
     * Create PostgreSQL tables
     * @returns {Promise<void>}
     */
    async createPostgreSQLTables() {
        const client = await this.pgPool.connect();
        
        try {
            // Enable UUID extension
            await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
            
            // Messages table with JSON support for Discord data
            await client.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    guild_id TEXT NOT NULL,
                    guild_name TEXT,
                    author_id TEXT NOT NULL,
                    author_display_name TEXT,
                    content TEXT,
                    message_data JSONB, -- Full Discord message object
                    relayed_message_id TEXT, -- ID of the relayed/webhook message
                    original_message_id TEXT, -- ID of the original message (if this is a relayed message)
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ,
                    instance_name TEXT NOT NULL,
                    processed_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            // Channel members table
            await client.query(`
                CREATE TABLE IF NOT EXISTS channel_members (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    channel_name TEXT,
                    guild_id TEXT NOT NULL,
                    guild_name TEXT,
                    user_id TEXT NOT NULL,
                    display_name TEXT,
                    member_data JSONB, -- Full Discord member object
                    status TEXT,
                    roles TEXT[],
                    platforms TEXT[],
                    instance_name TEXT NOT NULL,
                    last_seen TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            // Instance tracking table
            await client.query(`
                CREATE TABLE IF NOT EXISTS instances (
                    instance_name TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
                    config_data JSONB,
                    stats_data JSONB
                )
            `);

            // Performance metrics table
            await client.query(`
                CREATE TABLE IF NOT EXISTS performance_metrics (
                    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                    instance_name TEXT NOT NULL,
                    metric_type TEXT NOT NULL,
                    metric_data JSONB NOT NULL,
                    recorded_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);

            console.log(`[${this.instanceName}] PostgreSQL tables created successfully`);
            
        } finally {
            client.release();
        }
    }

    /**
     * Create PostgreSQL indexes
     * @returns {Promise<void>}
     */
    async createPostgreSQLIndexes() {
        const client = await this.pgPool.connect();
        
        try {
            const indexes = [
                // Messages indexes
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_channel_id ON messages(channel_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_guild_id ON messages(guild_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_author_id ON messages(author_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_instance ON messages(instance_name)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_content_search ON messages USING gin(to_tsvector(\'english\', content))',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_relayed_id ON messages(relayed_message_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_original_id ON messages(original_message_id)',
                
                // Members indexes
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_channel_id ON channel_members(channel_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_guild_id ON channel_members(guild_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_user_id ON channel_members(user_id)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_instance ON channel_members(instance_name)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_last_seen ON channel_members(last_seen DESC)',
                
                // Performance indexes
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_instance ON performance_metrics(instance_name)',
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_performance_recorded ON performance_metrics(recorded_at DESC)',
                
                // Instances indexes
                'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instances_heartbeat ON instances(last_heartbeat DESC)'
            ];

            for (const indexSQL of indexes) {
                try {
                    await client.query(indexSQL);
                } catch (error) {
                    // Ignore "already exists" errors
                    if (!error.message.includes('already exists')) {
                        console.warn(`[${this.instanceName}] Index creation warning:`, error.message);
                    }
                }
            }

            console.log(`[${this.instanceName}] PostgreSQL indexes created successfully`);
            
        } finally {
            client.release();
        }
    }

    /**
     * Update existing tables to add new columns if they don't exist
     * @returns {Promise<void>}
     */
    async updatePostgreSQLTables() {
        const client = await this.pgPool.connect();
        
        try {
            // Add relayed_message_id column if it doesn't exist
            await client.query(`
                ALTER TABLE messages 
                ADD COLUMN IF NOT EXISTS relayed_message_id TEXT
            `);
            
            // Add original_message_id column if it doesn't exist
            await client.query(`
                ALTER TABLE messages 
                ADD COLUMN IF NOT EXISTS original_message_id TEXT
            `);
            
            console.log(`[${this.instanceName}] PostgreSQL table updates completed`);
            
        } catch (error) {
            console.warn(`[${this.instanceName}] Error updating tables:`, error.message);
        } finally {
            client.release();
        }
    }

    /**
     * Add message to batch for processing
     * @param {Object} messageData - Message data object
     */
    addMessageToBatch(messageData) {
        // Add instance name to message data
        messageData.instanceName = this.instanceName;
        
        this.pendingMessageBatch.push(messageData);

        if (this.pendingMessageBatch.length >= this.BATCH_SIZE) {
            this.flushMessageBatch();
        } else {
            clearTimeout(this.messageBatchTimeout);
            this.messageBatchTimeout = setTimeout(() => this.flushMessageBatch(), this.BATCH_TIMEOUT);
        }
    }

    /**
     * Flush message batch to PostgreSQL
     * @returns {Promise<void>}
     */
    async flushMessageBatch() {
        if (this.pendingMessageBatch.length === 0) return;

        const batch = [...this.pendingMessageBatch];
        this.pendingMessageBatch.length = 0;
        clearTimeout(this.messageBatchTimeout);

        const client = await this.pgPool.connect();
        
        try {
            await client.query('BEGIN');
            
            let processedCount = 0;
            
            for (const messageData of batch) {
                const result = await client.query(`
                    INSERT INTO messages (
                        id, channel_id, channel_name, guild_id, guild_name,
                        author_id, author_display_name, content, message_data,
                        relayed_message_id, original_message_id,
                        created_at, updated_at, instance_name
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (id) DO UPDATE SET
                        content = EXCLUDED.content,
                        updated_at = EXCLUDED.updated_at,
                        message_data = EXCLUDED.message_data,
                        author_display_name = EXCLUDED.author_display_name,
                        relayed_message_id = EXCLUDED.relayed_message_id,
                        original_message_id = EXCLUDED.original_message_id
                    RETURNING id
                `, [
                    messageData.id,
                    messageData.channelId,
                    messageData.channelName,
                    messageData.guildId,
                    messageData.guildName,
                    messageData.authorId,
                    messageData.authorDisplayName,
                    messageData.content,
                    JSON.stringify(messageData.rawMessage || {}),
                    messageData.relayedMessageId || null,
                    messageData.originalMessageId || null,
                    new Date(messageData.createdAt),
                    messageData.updatedAt ? new Date(messageData.updatedAt) : null,
                    messageData.instanceName
                ]);
                
                if (result.rows.length > 0) {
                    processedCount++;
                    
                    // Cache the message data if cache manager is available
                    if (this.cacheManager) {
                        this.cacheManager.cacheMessage(messageData);
                    }
                }
            }
            
            await client.query('COMMIT');
            
            console.log(`[${this.instanceName}] Batch saved ${processedCount}/${batch.length} messages to PostgreSQL`);
            this.performanceStats.dbOperations += processedCount;
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`[${this.instanceName}] Error batch saving messages:`, error.message);
            this.performanceStats.errors++;
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Save member batch to PostgreSQL
     * @param {Array} memberBatch - Array of member data objects
     * @returns {Promise<void>}
     */
    async saveMemberBatch(memberBatch) {
        if (memberBatch.length === 0) return;

        const client = await this.pgPool.connect();
        
        try {
            await client.query('BEGIN');
            
            let processedCount = 0;
            
            for (const member of memberBatch) {
                const result = await client.query(`
                    INSERT INTO channel_members (
                        id, channel_id, channel_name, guild_id, guild_name,
                        user_id, display_name, member_data, status, roles, platforms, instance_name
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    ON CONFLICT (id) DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        member_data = EXCLUDED.member_data,
                        status = EXCLUDED.status,
                        roles = EXCLUDED.roles,
                        platforms = EXCLUDED.platforms,
                        last_seen = NOW(),
                        updated_at = NOW()
                    RETURNING id
                `, [
                    member.id,
                    member.channelId,
                    member.channelName,
                    member.guildId,
                    member.guildName,
                    member.userId,
                    member.displayName,
                    JSON.stringify(member.rawMember || {}),
                    member.status,
                    member.roles || [],
                    member.platforms || [],
                    this.instanceName
                ]);
                
                if (result.rows.length > 0) {
                    processedCount++;
                    
                    // Cache the member data if cache manager is available
                    if (this.cacheManager) {
                        this.cacheManager.cacheMember(member);
                    }
                }
            }
            
            await client.query('COMMIT');
            
            console.log(`[${this.instanceName}] Batch saved ${processedCount}/${memberBatch.length} members to PostgreSQL`);
            this.performanceStats.dbOperations += processedCount;
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`[${this.instanceName}] Error batch saving members:`, error.message);
            this.performanceStats.errors++;
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Record instance heartbeat
     */
    async recordHeartbeat(stats = {}) {
        try {
            const client = await this.pgPool.connect();
            
            try {
                await client.query(`
                    INSERT INTO instances (instance_name, status, last_heartbeat, stats_data)
                    VALUES ($1, $2, NOW(), $3)
                    ON CONFLICT (instance_name) DO UPDATE SET
                        status = EXCLUDED.status,
                        last_heartbeat = EXCLUDED.last_heartbeat,
                        stats_data = EXCLUDED.stats_data
                `, [this.instanceName, 'running', JSON.stringify(stats)]);
                
            } finally {
                client.release();
            }
        } catch (error) {
            console.warn(`[${this.instanceName}] Heartbeat recording error:`, error.message);
        }
    }

    /**
     * Get data with cache support
     * @param {string} type - Data type for cache key
     * @param {string} identifier - Unique identifier
     * @param {Function} pgQuery - Function that returns PostgreSQL data
     * @param {number} ttl - Cache TTL in seconds
     * @returns {Promise<any>} - Cached or fresh data
     */
    async getWithCache(type, identifier, pgQuery, ttl = 3600) {
        if (!this.cacheManager) {
            // No cache, just run the query
            const data = await pgQuery();
            if (this.performanceStats) {
                this.performanceStats.cacheMisses++;
            }
            return data;
        }

        const cacheKey = this.cacheManager.getCacheKey(type, identifier);
        return await this.cacheManager.getWithCache(cacheKey, pgQuery, ttl);
    }

    /**
     * Find message information by message ID (supports both original and relayed message IDs)
     * @param {string} messageId - Discord message ID (original or relayed)
     * @returns {Promise<Object|null>} - Original message data or null if not found
     */
    async findMessageById(messageId) {
        const client = await this.pgPool.connect();
        
        try {
            // First, try to find as original message
            let result = await client.query(
                'SELECT id, channel_id, channel_name, guild_id, guild_name, relayed_message_id FROM messages WHERE id = $1 LIMIT 1',
                [messageId]
            );
            
            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    messageId: row.id,
                    channelId: row.channel_id,
                    channelName: row.channel_name,
                    guildId: row.guild_id,
                    guildName: row.guild_name,
                    relayedMessageId: row.relayed_message_id,
                    isOriginal: true
                };
            }
            
            // If not found, try to find as relayed message and return the original
            result = await client.query(
                'SELECT id, channel_id, channel_name, guild_id, guild_name, relayed_message_id FROM messages WHERE relayed_message_id = $1 LIMIT 1',
                [messageId]
            );
            
            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    messageId: row.id, // Return the original message ID
                    channelId: row.channel_id, // Return the original channel ID
                    channelName: row.channel_name,
                    guildId: row.guild_id,
                    guildName: row.guild_name,
                    relayedMessageId: row.relayed_message_id,
                    isOriginal: false, // This indicates we found it via relayed message ID
                    queriedMessageId: messageId // The ID that was actually queried
                };
            }
            
            return null;
        } catch (error) {
            console.error(`[${this.instanceName}] Error querying message ${messageId}:`, error.message);
            return null;
        } finally {
            client.release();
        }
    }

    /**
     * Find original message by searching for any relayed message that might match
     * This is useful when the relayed relationship wasn't stored but we want to find the original
     * @param {string} relayedMessageId - Relayed message ID
     * @param {string} content - Message content to help match
     * @param {number} timestampRange - Time range in milliseconds to search within (default: 1 hour)
     * @returns {Promise<Object|null>} - Original message data or null if not found
     */
    async findOriginalByContent(relayedMessageId, content, timestampRange = 3600000) {
        const client = await this.pgPool.connect();
        
        try {
            // Search for messages with similar content within a time range
            // This is a fallback when the relayed relationship wasn't stored
            const result = await client.query(`
                SELECT id, channel_id, channel_name, guild_id, guild_name, created_at, relayed_message_id
                FROM messages 
                WHERE content = $1 
                AND relayed_message_id IS NULL
                AND created_at >= NOW() - INTERVAL '${Math.floor(timestampRange / 1000)} seconds'
                ORDER BY created_at DESC
                LIMIT 5
            `, [content]);
            
            if (result.rows.length > 0) {
                // Return the most recent match
                const row = result.rows[0];
                return {
                    messageId: row.id,
                    channelId: row.channel_id,
                    channelName: row.channel_name,
                    guildId: row.guild_id,
                    guildName: row.guild_name,
                    relayedMessageId: row.relayed_message_id,
                    isOriginal: true,
                    foundVia: 'content-match',
                    queriedMessageId: relayedMessageId
                };
            }
            
            return null;
        } catch (error) {
            console.error(`[${this.instanceName}] Error searching for original message by content:`, error.message);
            return null;
        } finally {
            client.release();
        }
    }

    /**
     * Update message with relayed message ID (with retry mechanism)
     * @param {string} originalMessageId - Original Discord message ID
     * @param {string} relayedMessageId - Relayed/webhook message ID
     * @returns {Promise<boolean>} - Success status
     */
    async updateMessageRelayedId(originalMessageId, relayedMessageId) {
        const maxRetries = 3;
        const retryDelay = 500; // 500ms
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const client = await this.pgPool.connect();
            
            try {
                const result = await client.query(
                    'UPDATE messages SET relayed_message_id = $1 WHERE id = $2 RETURNING id',
                    [relayedMessageId, originalMessageId]
                );
                
                if (result.rows.length > 0) {
                    console.log(`[${this.instanceName}] Updated message ${originalMessageId} with relayed ID ${relayedMessageId} (attempt ${attempt})`);
                    return true;
                }
                
                if (attempt < maxRetries) {
                    console.warn(`[${this.instanceName}] Message ${originalMessageId} not found for relationship update, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error(`[${this.instanceName}] Failed to update message relationship after ${maxRetries} attempts: message ${originalMessageId} not found in database`);
                }
                
            } catch (error) {
                console.error(`[${this.instanceName}] Error updating message relationship (attempt ${attempt}):`, error.message);
                if (attempt === maxRetries) {
                    return false;
                }
            } finally {
                client.release();
            }
        }
        
        return false;
    }

    /**
     * Manually set a relayed message relationship (useful for missing relationships)
     * @param {string} originalMessageId - Original Discord message ID
     * @param {string} relayedMessageId - Relayed/webhook message ID
     * @returns {Promise<boolean>} - Success status
     */
    async setMessageRelationship(originalMessageId, relayedMessageId) {
        const client = await this.pgPool.connect();
        
        try {
            // First, try to update the original message with the relayed ID
            let result = await client.query(
                'UPDATE messages SET relayed_message_id = $1 WHERE id = $2 RETURNING id',
                [relayedMessageId, originalMessageId]
            );
            
            if (result.rows.length > 0) {
                console.log(`[${this.instanceName}] Updated original message ${originalMessageId} with relayed ID ${relayedMessageId}`);
                return true;
            } else {
                // If original message not found, log but don't fail
                console.log(`[${this.instanceName}] Original message ${originalMessageId} not found in database, relationship noted but not stored`);
                return false;
            }
        } catch (error) {
            console.error(`[${this.instanceName}] Error setting message relationship:`, error.message);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Close database connections
     * @returns {Promise<void>}
     */
    async close() {
        console.log(`[${this.instanceName}] Closing database connections...`);
        
        // Clear any pending timeouts
        clearTimeout(this.messageBatchTimeout);
        clearTimeout(this.memberBatchTimeout);
        
        // Flush any pending batches
        await this.flushMessageBatch();
        
        // Record final heartbeat
        await this.recordHeartbeat({ status: 'shutting_down' });
        
        // Close PostgreSQL pool
        if (this.pgPool) {
            await this.pgPool.end();
            console.log(`[${this.instanceName}] PostgreSQL connection pool closed`);
        }
    }

    /**
     * Find original message by relayed message ID
     * @param {string} relayedMessageId - Relayed/webhook message ID
     * @returns {Promise<Object|null>} - Original message data or null if not found
     */
    async findOriginalByRelayedId(relayedMessageId) {
        const client = await this.pgPool.connect();
        
        try {
            // Search for the original message that has this relayed message ID
            const result = await client.query(
                'SELECT id, channel_id, channel_name, guild_id, guild_name FROM messages WHERE relayed_message_id = $1 LIMIT 1',
                [relayedMessageId]
            );
            
            if (result.rows.length > 0) {
                const row = result.rows[0];
                return {
                    messageId: row.id, // Original message ID
                    channelId: row.channel_id, // Original channel ID
                    channelName: row.channel_name,
                    guildId: row.guild_id,
                    guildName: row.guild_name,
                    isOriginal: true,
                    foundVia: 'relayed-id-lookup',
                    queriedMessageId: relayedMessageId
                };
            }
            
            return null;
        } catch (error) {
            console.error(`[${this.instanceName}] Error finding original by relayed ID ${relayedMessageId}:`, error.message);
            return null;
        } finally {
            client.release();
        }
    }

    /**
     * Immediately save a single message to the database (bypassing batching)
     * This is useful when we need to ensure the message exists before performing operations on it
     * @param {Object} messageData - Message data object
     * @returns {Promise<boolean>} - Success status
     */
    async saveMessageImmediate(messageData) {
        // Add instance name to message data
        messageData.instanceName = this.instanceName;
        
        const client = await this.pgPool.connect();
        
        try {
            const result = await client.query(`
                INSERT INTO messages (
                    id, channel_id, channel_name, guild_id, guild_name,
                    author_id, author_display_name, content, message_data,
                    relayed_message_id, original_message_id,
                    created_at, updated_at, instance_name
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (id) DO UPDATE SET
                    content = EXCLUDED.content,
                    updated_at = EXCLUDED.updated_at,
                    message_data = EXCLUDED.message_data,
                    author_display_name = EXCLUDED.author_display_name,
                    relayed_message_id = EXCLUDED.relayed_message_id,
                    original_message_id = EXCLUDED.original_message_id
                RETURNING id
            `, [
                messageData.id,
                messageData.channelId,
                messageData.channelName,
                messageData.guildId,
                messageData.guildName,
                messageData.authorId,
                messageData.authorDisplayName,
                messageData.content,
                JSON.stringify(messageData.rawMessage || {}),
                messageData.relayedMessageId || null,
                messageData.originalMessageId || null,
                new Date(messageData.createdAt),
                messageData.updatedAt ? new Date(messageData.updatedAt) : null,
                messageData.instanceName
            ]);
            
            if (result.rows.length > 0) {
                console.log(`[${this.instanceName}] Immediately saved message ${messageData.id} to database`);
                
                // Cache the message data if cache manager is available
                if (this.cacheManager) {
                    this.cacheManager.cacheMessage(messageData);
                }
                
                this.performanceStats.dbOperations++;
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`[${this.instanceName}] Error immediately saving message:`, error.message);
            return false;
        } finally {
            client.release();
        }
    }

    /**
     * Update an existing message without affecting relationship fields
     * @param {Object} messageData - Message data object
     * @returns {Promise<boolean>} - Success status
     */
    async updateMessageContent(messageData) {
        // Add instance name to message data
        messageData.instanceName = this.instanceName;
        
        const client = await this.pgPool.connect();
        
        try {
            const result = await client.query(`
                UPDATE messages SET
                    content = $1,
                    updated_at = $2,
                    message_data = $3,
                    author_display_name = $4
                WHERE id = $5
                RETURNING id
            `, [
                messageData.content,
                messageData.updatedAt ? new Date(messageData.updatedAt) : new Date(),
                JSON.stringify(messageData.rawMessage || {}),
                messageData.authorDisplayName,
                messageData.id
            ]);
            
            if (result.rows.length > 0) {
                console.log(`[${this.instanceName}] Updated message content for ${messageData.id} without affecting relationships`);
                
                // Cache the message data if cache manager is available
                if (this.cacheManager) {
                    this.cacheManager.cacheMessage(messageData);
                }
                
                this.performanceStats.dbOperations++;
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`[${this.instanceName}] Error updating message content:`, error.message);
            return false;
        } finally {
            client.release();
        }
    }
}

module.exports = DatabaseManager;
