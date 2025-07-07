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
                        created_at, updated_at, instance_name
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    ON CONFLICT (id) DO UPDATE SET
                        content = EXCLUDED.content,
                        updated_at = EXCLUDED.updated_at,
                        message_data = EXCLUDED.message_data,
                        author_display_name = EXCLUDED.author_display_name
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
}

module.exports = DatabaseManager;
