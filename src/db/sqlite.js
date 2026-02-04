import Database from 'better-sqlite3';
import { config } from '../config.js';
import crypto from 'crypto';

let db = null;

export function getDb() {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    // Run migrations first to update existing tables
    migrateSchema();
    // Then create any missing tables/indexes
    initSchema();
  }
  return db;
}

function initSchema() {
  // Check if trends table exists
  const trendsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trends'"
  ).get();

  if (!trendsExists) {
    // Create fresh schema for new database
    db.exec(`
      CREATE TABLE trends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cast_hash TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        author_fid INTEGER DEFAULT 0,
        author_handle TEXT NOT NULL,
        author_followers INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        recast_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        source TEXT NOT NULL,
        channel TEXT,
        keyword_match TEXT,
        virality_score REAL DEFAULT 0,
        processed INTEGER DEFAULT 0
      );
    `);
  }

  // Create other tables that might not exist
  db.exec(`
    -- Token launches
    CREATE TABLE IF NOT EXISTS launches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trend_id INTEGER NOT NULL,
      signer_uuid TEXT,
      token_name TEXT NOT NULL,
      token_ticker TEXT NOT NULL,
      cast_hash TEXT,
      cast_text TEXT,
      launched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      virality_score REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      FOREIGN KEY (trend_id) REFERENCES trends(id)
    );

    -- Daily stats for rate limiting
    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      signer_uuid TEXT,
      launches_count INTEGER DEFAULT 0,
      trends_detected INTEGER DEFAULT 0,
      trends_above_threshold INTEGER DEFAULT 0,
      UNIQUE(date, signer_uuid)
    );

    -- Deduplication
    CREATE TABLE IF NOT EXISTS seen_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT UNIQUE NOT NULL,
      content_type TEXT NOT NULL,
      first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Launched tokens for internal duplicate checking
    CREATE TABLE IF NOT EXISTS launched_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_name TEXT NOT NULL,
      token_ticker TEXT NOT NULL,
      signer_uuid TEXT,
      launch_id INTEGER,
      launched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (launch_id) REFERENCES launches(id),
      UNIQUE(token_ticker, signer_uuid)
    );

    -- FID cache for username lookups
    CREATE TABLE IF NOT EXISTS fid_cache (
      username TEXT PRIMARY KEY,
      fid INTEGER NOT NULL,
      follower_count INTEGER DEFAULT 0,
      cached_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Activity log for dashboard
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      action TEXT NOT NULL,
      details TEXT,
      signer_uuid TEXT
    );

    -- Scheduled casts
    CREATE TABLE IF NOT EXISTS scheduled_casts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      image_url TEXT,
      scheduled_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending',
      cast_hash TEXT,
      error_message TEXT,
      signer_uuid TEXT
    );

    -- Farcaster signers (from SIWN or env)
    CREATE TABLE IF NOT EXISTS signers (
      signer_uuid TEXT PRIMARY KEY,
      fid INTEGER,
      username TEXT,
      display_name TEXT,
      status TEXT,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Token launch queue (for review before launching)
    CREATE TABLE IF NOT EXISTS token_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trend_id INTEGER NOT NULL,
      signer_uuid TEXT,
      token_name TEXT NOT NULL,
      token_ticker TEXT NOT NULL,
      cast_text TEXT NOT NULL,
      image_url TEXT,
      source_cast_hash TEXT,
      source_cast_url TEXT,
      source_author TEXT,
      source_text TEXT,
      source_type TEXT DEFAULT 'farcaster',
      virality_score REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending',
      launched_at TEXT,
      launch_cast_hash TEXT,
      error_message TEXT,
      FOREIGN KEY (trend_id) REFERENCES trends(id)
    );

    -- Indexes for performance (on existing columns)
    CREATE INDEX IF NOT EXISTS idx_trends_processed ON trends(processed);
    CREATE INDEX IF NOT EXISTS idx_trends_virality ON trends(virality_score DESC);
    CREATE INDEX IF NOT EXISTS idx_launches_status ON launches(status);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
    CREATE INDEX IF NOT EXISTS idx_launched_tokens_ticker ON launched_tokens(token_ticker);
    CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_scheduled_casts_status ON scheduled_casts(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_token_queue_status ON token_queue(status);
    CREATE INDEX IF NOT EXISTS idx_signers_fid ON signers(fid);
    CREATE INDEX IF NOT EXISTS idx_launches_signer ON launches(signer_uuid);
    CREATE INDEX IF NOT EXISTS idx_token_queue_signer ON token_queue(signer_uuid);
    CREATE INDEX IF NOT EXISTS idx_scheduled_signer ON scheduled_casts(signer_uuid);
    CREATE INDEX IF NOT EXISTS idx_logs_signer ON activity_log(signer_uuid);
    CREATE INDEX IF NOT EXISTS idx_launched_tokens_signer ON launched_tokens(signer_uuid);
  `);

  // Create cast_hash index only if the column exists
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_trends_cast_hash ON trends(cast_hash)');
  } catch (e) {
    // Column might still be named tweet_id, that's fine
  }
}

// Migrate from old Twitter schema to Farcaster schema
function migrateSchema() {
  // Check if we need to migrate (old schema has tweet_id column)
  const tableInfo = db.prepare("PRAGMA table_info('trends')").all();
  const columns = tableInfo.map((col) => col.name);

  // Migrate tweet_id to cast_hash
  if (columns.includes('tweet_id') && !columns.includes('cast_hash')) {
    console.log('Migrating database schema from Twitter to Farcaster...');

    db.exec(`
      ALTER TABLE trends RENAME COLUMN tweet_id TO cast_hash;
    `);
    console.log('  - Renamed tweet_id to cast_hash');
  }

  // Migrate retweet_count to recast_count
  if (columns.includes('retweet_count') && !columns.includes('recast_count')) {
    db.exec(`
      ALTER TABLE trends RENAME COLUMN retweet_count TO recast_count;
    `);
    console.log('  - Renamed retweet_count to recast_count');
  }

  // Add author_fid column if missing
  if (!columns.includes('author_fid')) {
    db.exec(`
      ALTER TABLE trends ADD COLUMN author_fid INTEGER DEFAULT 0;
    `);
    console.log('  - Added author_fid column');
  }

  // Add channel column if missing
  if (!columns.includes('channel')) {
    db.exec(`
      ALTER TABLE trends ADD COLUMN channel TEXT;
    `);
    console.log('  - Added channel column');
  }

  // Add signer_uuid columns where missing
  const addColumnIfMissing = (table, column, type = 'TEXT') => {
    const info = db.prepare(`PRAGMA table_info('${table}')`).all();
    const cols = info.map((col) => col.name);
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
      console.log(`  - Added ${column} to ${table}`);
    }
  };

  addColumnIfMissing('launches', 'signer_uuid');
  addColumnIfMissing('token_queue', 'signer_uuid');
  addColumnIfMissing('token_queue', 'source_type', "'farcaster'");
  addColumnIfMissing('scheduled_casts', 'signer_uuid');
  addColumnIfMissing('activity_log', 'signer_uuid');
  // Launched tokens: migrate to signer-aware schema if needed
  const launchedInfo = db.prepare("PRAGMA table_info('launched_tokens')").all();
  const launchedCols = launchedInfo.map((col) => col.name);
  if (!launchedCols.includes('signer_uuid')) {
    console.log('Migrating launched_tokens to signer-aware schema...');
    db.exec(`
      ALTER TABLE launched_tokens RENAME TO launched_tokens_old;
      CREATE TABLE launched_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_name TEXT NOT NULL,
        token_ticker TEXT NOT NULL,
        signer_uuid TEXT,
        launch_id INTEGER,
        launched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (launch_id) REFERENCES launches(id),
        UNIQUE(token_ticker, signer_uuid)
      );
      INSERT INTO launched_tokens (token_name, token_ticker, signer_uuid, launch_id, launched_at)
      SELECT token_name, token_ticker, NULL, launch_id, launched_at
      FROM launched_tokens_old;
      DROP TABLE launched_tokens_old;
      CREATE INDEX IF NOT EXISTS idx_launched_tokens_ticker ON launched_tokens(token_ticker);
      CREATE INDEX IF NOT EXISTS idx_launched_tokens_signer ON launched_tokens(signer_uuid);
    `);
  }

  // Daily stats: migrate to signer-aware table if needed
  const dailyInfo = db.prepare("PRAGMA table_info('daily_stats')").all();
  const dailyCols = dailyInfo.map((col) => col.name);
  if (!dailyCols.includes('signer_uuid')) {
    console.log('Migrating daily_stats to signer-aware schema...');
    db.exec(`
      ALTER TABLE daily_stats RENAME TO daily_stats_old;
      CREATE TABLE daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        signer_uuid TEXT,
        launches_count INTEGER DEFAULT 0,
        trends_detected INTEGER DEFAULT 0,
        trends_above_threshold INTEGER DEFAULT 0,
        UNIQUE(date, signer_uuid)
      );
      INSERT INTO daily_stats (date, signer_uuid, launches_count, trends_detected, trends_above_threshold)
      SELECT date, NULL, launches_count, trends_detected, trends_above_threshold
      FROM daily_stats_old;
      DROP TABLE daily_stats_old;
      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
    `);
  }
}

// Content hash for deduplication
export function hashContent(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

// Check if content has been seen
export function isContentSeen(contentHash) {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM seen_content WHERE content_hash = ?').get(contentHash);
  return !!row;
}

// Mark content as seen
export function markContentSeen(contentHash, contentType) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO seen_content (content_hash, content_type)
    VALUES (?, ?)
  `).run(contentHash, contentType);
}

// Insert a trend (cast)
export function insertTrend(cast) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO trends (
      cast_hash, text, author_fid, author_handle, author_followers,
      reply_count, recast_count, like_count, created_at,
      source, channel, keyword_match
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    cast.castHash,
    cast.text,
    cast.authorFid || 0,
    cast.authorHandle,
    cast.authorFollowers || 0,
    cast.replyCount || 0,
    cast.recastCount || 0,
    cast.likeCount || 0,
    cast.createdAt,
    cast.source,
    cast.channel || null,
    cast.keywordMatch || null
  );

  return result.lastInsertRowid;
}

// Update trend score
export function updateTrendScore(trendId, score, processed = 1) {
  const db = getDb();
  db.prepare(`
    UPDATE trends SET virality_score = ?, processed = ?
    WHERE id = ?
  `).run(score, processed, trendId);
}

// Get unprocessed trends
export function getUnprocessedTrends() {
  const db = getDb();
  return db.prepare('SELECT * FROM trends WHERE processed = 0').all();
}

// Get top scoring unprocessed trend
export function getTopScoredTrend(threshold) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM trends
    WHERE processed = 1 AND virality_score >= ?
    ORDER BY virality_score DESC
    LIMIT 1
  `).get(threshold);
}

// Mark trend as launched
export function markTrendLaunched(trendId) {
  const db = getDb();
  db.prepare('UPDATE trends SET processed = 3 WHERE id = ?').run(trendId);
}

// Mark trend as rejected
export function markTrendRejected(trendId) {
  const db = getDb();
  db.prepare('UPDATE trends SET processed = 2 WHERE id = ?').run(trendId);
}

// Insert a launch
export function insertLaunch(launch) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO launches (
      trend_id, signer_uuid, token_name, token_ticker, cast_hash,
      cast_text, virality_score, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    launch.trendId,
    launch.signerUuid || null,
    launch.tokenName,
    launch.tokenTicker,
    launch.castHash || null,
    launch.castText || null,
    launch.viralityScore,
    launch.status || 'pending',
    launch.errorMessage || null
  );

  return result.lastInsertRowid;
}

// Update launch status
export function updateLaunchStatus(launchId, status, castHash = null, errorMessage = null) {
  const db = getDb();
  db.prepare(`
    UPDATE launches SET status = ?, cast_hash = ?, error_message = ?
    WHERE id = ?
  `).run(status, castHash, errorMessage, launchId);
}

// Get recent launches
export function getRecentLaunches(limit = 10, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    return db.prepare(`
      SELECT l.*, t.text as trend_text, t.author_handle, t.channel
      FROM launches l
      JOIN trends t ON l.trend_id = t.id
      WHERE l.signer_uuid = ?
      ORDER BY l.launched_at DESC
      LIMIT ?
    `).all(signerUuid, limit);
  }
  return db.prepare(`
    SELECT l.*, t.text as trend_text, t.author_handle, t.channel
    FROM launches l
    JOIN trends t ON l.trend_id = t.id
    ORDER BY l.launched_at DESC
    LIMIT ?
  `).all(limit);
}

// Get last launch time
export function getLastLaunchTime() {
  const db = getDb();
  const row = db.prepare(`
    SELECT launched_at FROM launches
    WHERE status = 'success'
    ORDER BY launched_at DESC
    LIMIT 1
  `).get();
  return row ? new Date(row.launched_at) : null;
}

// Daily stats operations
export function getTodayStats(signerUuid = null) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  let row = db
    .prepare('SELECT * FROM daily_stats WHERE date = ? AND signer_uuid IS ?')
    .get(today, signerUuid);

  if (!row) {
    db.prepare('INSERT INTO daily_stats (date, signer_uuid) VALUES (?, ?)').run(today, signerUuid);
    row = db
      .prepare('SELECT * FROM daily_stats WHERE date = ? AND signer_uuid IS ?')
      .get(today, signerUuid);
  }

  return row;
}

export function incrementDailyStat(field, signerUuid = null) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  getTodayStats(signerUuid); // Ensure row exists
  db.prepare(`UPDATE daily_stats SET ${field} = ${field} + 1 WHERE date = ? AND signer_uuid IS ?`).run(
    today,
    signerUuid
  );
}

// Get recent trends with scores (last 60 mins)
export function getRecentTrends(limit = 20) {
  const db = getDb();
  const sixtyMinsAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM trends
    WHERE detected_at >= ?
    ORDER BY detected_at DESC
    LIMIT ?
  `).all(sixtyMinsAgo, limit);
}

// Get top scoring trends (last 60 mins)
export function getTopTrends(limit = 50) {
  const db = getDb();
  const sixtyMinsAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM trends
    WHERE detected_at >= ?
    ORDER BY virality_score DESC
    LIMIT ?
  `).all(sixtyMinsAgo, limit);
}

// Get historical stats
export function getHistoricalStats(days = 30, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    return db.prepare(`
      SELECT * FROM daily_stats
      WHERE signer_uuid = ?
      ORDER BY date DESC
      LIMIT ?
    `).all(signerUuid, days);
  }
  return db.prepare(`
    SELECT * FROM daily_stats
    ORDER BY date DESC
    LIMIT ?
  `).all(days);
}

// FID cache operations
export function cacheFid(username, fid, followerCount) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO fid_cache (username, fid, follower_count, cached_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(username.toLowerCase(), fid, followerCount);
}

export function getCachedFid(username) {
  const db = getDb();
  return db.prepare('SELECT * FROM fid_cache WHERE username = ?').get(username.toLowerCase());
}

// Launched tokens operations
export function isTokenLaunched(ticker, signerUuid = null) {
  const db = getDb();
  const row = signerUuid
    ? db
        .prepare(
          'SELECT 1 FROM launched_tokens WHERE UPPER(token_ticker) = ? AND signer_uuid = ?'
        )
        .get(ticker.toUpperCase(), signerUuid)
    : db.prepare('SELECT 1 FROM launched_tokens WHERE UPPER(token_ticker) = ?').get(ticker.toUpperCase());
  return !!row;
}

export function registerLaunchedToken(tokenName, ticker, launchId, signerUuid = null) {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO launched_tokens (token_name, token_ticker, launch_id, signer_uuid)
      VALUES (?, ?, ?, ?)
    `).run(tokenName, ticker.toUpperCase(), launchId, signerUuid);
  } catch (err) {
    console.error(`Failed to register launched token: ${err.message}`);
  }
}

// Activity log operations
export function logActivity(action, details = null, signerUuid = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO activity_log (action, details, signer_uuid)
    VALUES (?, ?, ?)
  `).run(action, details ? JSON.stringify(details) : null, signerUuid);
}

export function getRecentLogs(limit = 50, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    return db.prepare(`
      SELECT * FROM activity_log
      WHERE signer_uuid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(signerUuid, limit);
  }
  return db.prepare(`
    SELECT * FROM activity_log
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit);
}

// Scheduled casts operations
export function schedulecast(text, scheduledAt, imageUrl = null, signerUuid = null) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO scheduled_casts (text, image_url, scheduled_at, signer_uuid)
    VALUES (?, ?, ?, ?)
  `).run(text, imageUrl, scheduledAt, signerUuid);
  return result.lastInsertRowid;
}

export function getPendingScheduledCasts(signerUuid = null) {
  const db = getDb();
  const now = new Date().toISOString();
  if (signerUuid) {
    return db.prepare(`
      SELECT * FROM scheduled_casts
      WHERE status = 'pending' AND scheduled_at <= ? AND signer_uuid = ?
      ORDER BY scheduled_at ASC
    `).all(now, signerUuid);
  }
  return db.prepare(`
    SELECT * FROM scheduled_casts
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `).all(now);
}

export function getScheduledCasts(limit = 20, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    return db.prepare(`
      SELECT * FROM scheduled_casts
      WHERE signer_uuid = ?
      ORDER BY scheduled_at DESC
      LIMIT ?
    `).all(signerUuid, limit);
  }
  return db.prepare(`
    SELECT * FROM scheduled_casts
    ORDER BY scheduled_at DESC
    LIMIT ?
  `).all(limit);
}

export function getScheduledCast(id, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    return db.prepare(`
      SELECT * FROM scheduled_casts
      WHERE id = ? AND signer_uuid = ?
    `).get(id, signerUuid);
  }
  return db.prepare(`
    SELECT * FROM scheduled_casts
    WHERE id = ?
  `).get(id);
}

export function updateScheduledCastStatus(id, status, castHash = null, errorMessage = null) {
  const db = getDb();
  db.prepare(`
    UPDATE scheduled_casts
    SET status = ?, cast_hash = ?, error_message = ?
    WHERE id = ?
  `).run(status, castHash, errorMessage, id);
}

export function updateScheduledCast(id, scheduledAt, imageUrl = null, text = null) {
  const db = getDb();
  db.prepare(`
    UPDATE scheduled_casts
    SET scheduled_at = ?, image_url = ?, text = ?
    WHERE id = ?
  `).run(scheduledAt, imageUrl, text, id);
}

export function upsertSigner(data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO signers (signer_uuid, fid, username, display_name, status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(signer_uuid) DO UPDATE SET
      fid = excluded.fid,
      username = excluded.username,
      display_name = excluded.display_name,
      status = excluded.status
  `).run(
    data.signerUuid,
    data.fid || null,
    data.username || null,
    data.displayName || null,
    data.status || null
  );
}

export function getSigners() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM signers
    ORDER BY added_at DESC
  `).all();
}

export function getSignerByUuid(signerUuid) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM signers
    WHERE signer_uuid = ?
  `).get(signerUuid);
}

export function updateSigner(signerUuid, data) {
  const db = getDb();
  const fields = [];
  const values = [];

  if (data.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(data.displayName);
  }
  if (data.username !== undefined) {
    fields.push('username = ?');
    values.push(data.username);
  }

  if (fields.length === 0) return;

  values.push(signerUuid);
  db.prepare(`UPDATE signers SET ${fields.join(', ')} WHERE signer_uuid = ?`).run(...values);
}

export function deleteSigner(signerUuid) {
  const db = getDb();
  db.prepare('DELETE FROM signers WHERE signer_uuid = ?').run(signerUuid);
}

export function deleteScheduledCast(id, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    db.prepare('DELETE FROM scheduled_casts WHERE id = ? AND status = ? AND signer_uuid = ?')
      .run(id, 'pending', signerUuid);
    return;
  }
  db.prepare('DELETE FROM scheduled_casts WHERE id = ? AND status = ?').run(id, 'pending');
}

export function getScheduledCastsStats(signerUuid = null) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM scheduled_casts
    WHERE DATE(created_at) = ? AND (signer_uuid = ? OR ? IS NULL)
  `).get(today, signerUuid, signerUuid);
  return row || { total: 0, pending: 0, posted: 0, failed: 0 };
}

// Token queue operations
export function queueToken(data) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO token_queue (
      trend_id, signer_uuid, token_name, token_ticker, cast_text, image_url,
      source_cast_hash, source_cast_url, source_author, source_text, source_type, virality_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.trendId,
    data.signerUuid || null,
    data.tokenName,
    data.tokenTicker,
    data.castText,
    data.imageUrl || null,
    data.sourceCastHash || null,
    data.sourceCastUrl || null,
    data.sourceAuthor || null,
    data.sourceText || null,
    data.sourceType || 'farcaster',
    data.viralityScore
  );
  return result.lastInsertRowid;
}

export function getTokenQueue(status = null, limit = 50, signerUuid = null) {
  const db = getDb();
  if (status) {
    if (signerUuid) {
      return db.prepare(`
        SELECT * FROM token_queue
        WHERE status = ? AND signer_uuid = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(status, signerUuid, limit);
    }
    return db.prepare(`
      SELECT * FROM token_queue
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(status, limit);
  }
  if (signerUuid) {
    return db.prepare(`
      SELECT * FROM token_queue
      WHERE signer_uuid = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(signerUuid, limit);
  }
  return db.prepare(`
    SELECT * FROM token_queue
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getQueuedToken(id, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    return db.prepare('SELECT * FROM token_queue WHERE id = ? AND signer_uuid = ?').get(id, signerUuid);
  }
  return db.prepare('SELECT * FROM token_queue WHERE id = ?').get(id);
}

export function updateQueuedToken(id, data) {
  const db = getDb();
  const fields = [];
  const values = [];

  if (data.tokenName !== undefined) { fields.push('token_name = ?'); values.push(data.tokenName); }
  if (data.tokenTicker !== undefined) { fields.push('token_ticker = ?'); values.push(data.tokenTicker); }
  if (data.castText !== undefined) { fields.push('cast_text = ?'); values.push(data.castText); }
  if (data.imageUrl !== undefined) { fields.push('image_url = ?'); values.push(data.imageUrl); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.launchCastHash !== undefined) { fields.push('launch_cast_hash = ?'); values.push(data.launchCastHash); }
  if (data.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(data.errorMessage); }
  if (data.launchedAt !== undefined) { fields.push('launched_at = ?'); values.push(data.launchedAt); }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE token_queue SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteQueuedToken(id, signerUuid = null) {
  const db = getDb();
  if (signerUuid) {
    db.prepare('DELETE FROM token_queue WHERE id = ? AND status = ? AND signer_uuid = ?')
      .run(id, 'pending', signerUuid);
    return;
  }
  db.prepare('DELETE FROM token_queue WHERE id = ? AND status = ?').run(id, 'pending');
}

// Close database connection
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
