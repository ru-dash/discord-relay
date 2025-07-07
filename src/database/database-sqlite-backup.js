const sqlite3 = require('sqlite3').verbose();

class DatabaseManager {
    constructor(dbPath = './messages.db') {
        this.dbPath = dbPath;
        this.db = null;
        this.pendingMessageBatch = [];
        this.pendingMemberBatch = [];
        this.BATCH_SIZE = 100;
        this.BATCH_TIMEOUT = 3000;
        this.messageBatchTimeout = null;
        this.memberBatchTimeout = null;
        this.performanceStats = null;
    }

    /**
     * Initialize database connection and setup
     * @param {Object} performanceStats - Performance statistics object
     * @returns {Promise<void>}
     */
    async initialize(performanceStats) {
        this.performanceStats = performanceStats;
        
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => {
                if (err) {
                    console.error('Error connecting to SQLite:', err.message);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database.');
                    try {
                        this.setupOptimizations();
                        await this.createTablesAsync();
                        await this.createIndexesAsync();
                        await this.preparePreparedStatementsAsync();
                        this.setupPeriodicCheckpoint();
                        resolve();
                    } catch (error) {
                        console.error('Error initializing database:', error.message);
                        reject(error);
                    }
                }
            });
        });
    }

    /**
     * Setup SQLite optimizations
     */
    setupOptimizations() {
        this.db.run('PRAGMA journal_mode = WAL;');
        this.db.run('PRAGMA synchronous = NORMAL;');
        this.db.run('PRAGMA cache_size = 50000;');
        this.db.run('PRAGMA temp_store = MEMORY;');
        this.db.run('PRAGMA mmap_size = 536870912;'); // 512MB memory map
        this.db.run('PRAGMA page_size = 4096;');
        this.db.run('PRAGMA busy_timeout = 15000;');
        this.db.run('PRAGMA wal_autocheckpoint = 1000;');
        this.db.run('PRAGMA optimize;');
    }

    /**
     * Create database tables
     */
    createTables() {
        // Messages table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS messages (
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
            )
        `, (err) => {
            if (err) {
                console.error('Error creating messages table:', err.message);
            } else {
                console.log('Messages table ensured.');
            }
        });

        // Channel members table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS channel_members (
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
            )
        `, (err) => {
            if (err) {
                console.error('Error creating channel_members table:', err.message);
            } else {
                console.log('Channel members table ensured.');
            }
        });
    }

    /**
     * Create database tables (async version)
     */
    async createTablesAsync() {
        return new Promise((resolve, reject) => {
            let completedTables = 0;
            const totalTables = 2;
            let hasError = false;

            const checkCompletion = (err) => {
                if (err && !hasError) {
                    hasError = true;
                    reject(err);
                    return;
                }
                
                completedTables++;
                if (completedTables === totalTables && !hasError) {
                    resolve();
                }
            };

            // Messages table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS messages (
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
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating messages table:', err.message);
                    checkCompletion(err);
                } else {
                    console.log('Messages table ensured.');
                    checkCompletion();
                }
            });

            // Channel members table
            this.db.run(`
                CREATE TABLE IF NOT EXISTS channel_members (
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
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating channel_members table:', err.message);
                    checkCompletion(err);
                } else {
                    console.log('Channel members table ensured.');
                    checkCompletion();
                }
            });
        });
    }

    /**
     * Create database indexes
     */
    createIndexes() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channelId);',
            'CREATE INDEX IF NOT EXISTS idx_messages_guild_id ON messages(guildId);',
            'CREATE INDEX IF NOT EXISTS idx_messages_author_id ON messages(authorId);',
            'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(createdAt);',
            'CREATE INDEX IF NOT EXISTS idx_channel_members_channel_id ON channel_members(channelId);',
            'CREATE INDEX IF NOT EXISTS idx_channel_members_guild_id ON channel_members(guildId);',
            'CREATE INDEX IF NOT EXISTS idx_channel_members_user_id ON channel_members(userId);'
        ];

        indexes.forEach(index => {
            this.db.run(index);
        });
    }

    /**
     * Create database indexes (async version)
     */
    async createIndexesAsync() {
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channelId);',
            'CREATE INDEX IF NOT EXISTS idx_messages_guild_id ON messages(guildId);',
            'CREATE INDEX IF NOT EXISTS idx_messages_author_id ON messages(authorId);',
            'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(createdAt);',
            'CREATE INDEX IF NOT EXISTS idx_channel_members_channel_id ON channel_members(channelId);',
            'CREATE INDEX IF NOT EXISTS idx_channel_members_guild_id ON channel_members(guildId);',
            'CREATE INDEX IF NOT EXISTS idx_channel_members_user_id ON channel_members(userId);'
        ];

        return new Promise((resolve, reject) => {
            let completedIndexes = 0;
            let hasError = false;

            const checkCompletion = (err) => {
                if (err && !hasError) {
                    hasError = true;
                    reject(err);
                    return;
                }
                
                completedIndexes++;
                if (completedIndexes === indexes.length && !hasError) {
                    resolve();
                }
            };

            indexes.forEach(index => {
                this.db.run(index, (err) => {
                    checkCompletion(err);
                });
            });
        });
    }

    /**
     * Prepare SQL statements for better performance
     */
    preparePreparedStatements() {
        this.db.messageInsertStmt = this.db.prepare(`
            INSERT INTO messages (id, channelId, channelName, guildId, guildName, authorId, authorDisplayName, content, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) 
            DO UPDATE SET
                content = excluded.content,
                updatedAt = excluded.updatedAt,
                guildName = excluded.guildName,
                channelName = excluded.channelName,
                authorDisplayName = excluded.authorDisplayName
        `);
        
        this.db.memberInsertStmt = this.db.prepare(`
            INSERT INTO channel_members (id, channelId, channelName, guildId, guildName, userId, displayName, roles, status, platforms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id)
            DO UPDATE SET
                displayName = excluded.displayName,
                roles = excluded.roles,
                status = excluded.status,
                platforms = excluded.platforms
        `);
    }

    /**
     * Prepare SQL statements for better performance (async version)
     */
    async preparePreparedStatementsAsync() {
        return new Promise((resolve, reject) => {
            try {
                this.db.messageInsertStmt = this.db.prepare(`
                    INSERT INTO messages (id, channelId, channelName, guildId, guildName, authorId, authorDisplayName, content, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) 
                    DO UPDATE SET
                        content = excluded.content,
                        updatedAt = excluded.updatedAt,
                        guildName = excluded.guildName,
                        channelName = excluded.channelName,
                        authorDisplayName = excluded.authorDisplayName
                `);
                
                this.db.memberInsertStmt = this.db.prepare(`
                    INSERT INTO channel_members (id, channelId, channelName, guildId, guildName, userId, displayName, roles, status, platforms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id)
                    DO UPDATE SET
                        displayName = excluded.displayName,
                        roles = excluded.roles,
                        status = excluded.status,
                        platforms = excluded.platforms
                `);
                
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Add message to batch for processing
     * @param {Object} messageData - Message data object
     */
    addMessageToBatch(messageData) {
        this.pendingMessageBatch.push(messageData);

        if (this.pendingMessageBatch.length >= this.BATCH_SIZE) {
            this.flushMessageBatch();
        } else {
            clearTimeout(this.messageBatchTimeout);
            this.messageBatchTimeout = setTimeout(() => this.flushMessageBatch(), this.BATCH_TIMEOUT);
        }
    }

    /**
     * Flush message batch to database
     * @returns {Promise<void>}
     */
    flushMessageBatch() {
        if (this.pendingMessageBatch.length === 0) return Promise.resolve();

        const batch = [...this.pendingMessageBatch];
        this.pendingMessageBatch.length = 0;
        clearTimeout(this.messageBatchTimeout);

        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN IMMEDIATE TRANSACTION');
                
                let processedCount = 0;
                let hasErrors = false;
                
                batch.forEach(messageData => {
                    this.db.messageInsertStmt.run([
                        messageData.id,
                        messageData.channelId,
                        messageData.channelName,
                        messageData.guildId,
                        messageData.guildName,
                        messageData.authorId,
                        messageData.authorDisplayName,
                        messageData.content,
                        messageData.createdAt,
                        messageData.updatedAt,
                    ], function(err) {
                        if (err) {
                            console.error('Error inserting message:', err.message);
                            hasErrors = true;
                        } else {
                            processedCount++;
                        }
                    });
                });
                
                this.db.run(hasErrors ? 'ROLLBACK' : 'COMMIT', (err) => {
                    if (err) {
                        console.error('Error batch saving messages to SQLite:', err.message);
                        this.performanceStats.errors++;
                        reject(err);
                    } else {
                        console.log(`Batch saved ${processedCount}/${batch.length} messages to SQLite.`);
                        this.performanceStats.dbOperations += processedCount;
                        
                        // Trigger checkpoint after successful batch
                        this.triggerCheckpoint();
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Trigger an immediate WAL checkpoint
     */
    triggerCheckpoint() {
        this.db.run("PRAGMA wal_checkpoint(PASSIVE)", (err) => {
            if (err) {
                console.error('Error during checkpoint:', err.message);
            }
        });
    }

    /**
     * Save member batch to database
     * @param {Array} memberBatch - Array of member data objects
     * @returns {Promise<void>}
     */
    saveMemberBatch(memberBatch) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('BEGIN IMMEDIATE TRANSACTION');
                
                let processedCount = 0;
                let hasErrors = false;
                
                memberBatch.forEach(member => {
                    this.db.memberInsertStmt.run([
                        member.id,
                        member.channelId,
                        member.channelName,
                        member.guildId,
                        member.guildName,
                        member.userId,
                        member.displayName,
                        member.roles,
                        member.status,
                        member.platforms
                    ], function(err) {
                        if (err) {
                            console.error('Error inserting member:', err.message);
                            hasErrors = true;
                        } else {
                            processedCount++;
                        }
                    });
                });
                
                this.db.run(hasErrors ? 'ROLLBACK' : 'COMMIT', (err) => {
                    if (err) {
                        console.error('Error batch saving channel members to SQLite:', err.message);
                        this.performanceStats.errors++;
                        reject(err);
                    } else {
                        console.log(`Batch saved ${processedCount}/${memberBatch.length} members to SQLite.`);
                        this.performanceStats.dbOperations += processedCount;
                        
                        // Trigger checkpoint after successful batch
                        this.triggerCheckpoint();
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Setup periodic WAL checkpoint to ensure data is written to main database file
     */
    setupPeriodicCheckpoint() {
        // Checkpoint every 5 minutes to ensure data visibility
        this.checkpointInterval = setInterval(() => {
            this.db.run("PRAGMA wal_checkpoint(PASSIVE)", (err) => {
                if (err) {
                    console.error('Error during periodic WAL checkpoint:', err.message);
                } else {
                    console.log('Periodic WAL checkpoint completed');
                }
            });
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Close database connection
     * @returns {Promise<void>}
     */
    close() {
        return new Promise((resolve, reject) => {
            // Clear checkpoint interval
            if (this.checkpointInterval) {
                clearInterval(this.checkpointInterval);
            }
            
            // Perform final checkpoint
            this.db.run("PRAGMA wal_checkpoint(FULL)", (err) => {
                if (err) {
                    console.error('Error during final WAL checkpoint:', err.message);
                }
                
                // Close prepared statements
                if (this.db.messageInsertStmt) {
                    this.db.messageInsertStmt.finalize();
                }
                if (this.db.memberInsertStmt) {
                    this.db.memberInsertStmt.finalize();
                }
                
                // Close database connection
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                        reject(err);
                    } else {
                        console.log('Database connection closed.');
                        resolve();
                    }
                });
            });
        });
    }
}

module.exports = DatabaseManager;
