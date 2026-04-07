import { createClient } from '@libsql/client';
import { config } from '../config.js';
import crypto from 'crypto';

let db = null;

export async function getDb() {
  if (!db) {
    db = createClient({
      url: config.dbUrl,
      authToken: config.dbAuthToken || undefined,
    });
    await initSchema();
  }
  return db;
}

async function initSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS platforms (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
      credentials TEXT NOT NULL, metadata TEXT, enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, media TEXT,
      status TEXT DEFAULT 'draft', scheduled_at TEXT, posted_at TEXT,
      recurring_rule_id INTEGER, queue_slot_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS post_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL,
      platform_id TEXT NOT NULL, platform_post_id TEXT, platform_url TEXT,
      status TEXT DEFAULT 'pending', error_message TEXT, posted_at TEXT,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (platform_id) REFERENCES platforms(id)
    )`,
    `CREATE TABLE IF NOT EXISTS post_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL,
      platform_id TEXT NOT NULL, body TEXT, media TEXT,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (platform_id) REFERENCES platforms(id),
      UNIQUE(post_id, platform_id)
    )`,
    `CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime_type TEXT NOT NULL,
      size_bytes INTEGER, path TEXT NOT NULL, url TEXT,
      width INTEGER, height INTEGER, duration_ms INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS queue_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, platform_id TEXT,
      day_of_week INTEGER NOT NULL, time TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC', enabled INTEGER DEFAULT 1,
      FOREIGN KEY (platform_id) REFERENCES platforms(id)
    )`,
    `CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL,
      cron_expression TEXT NOT NULL, timezone TEXT DEFAULT 'UTC',
      next_run_at TEXT, last_run_at TEXT, repeat_count INTEGER DEFAULT 0,
      runs_completed INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      action TEXT NOT NULL, details TEXT, platform_id TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_queue_slot ON posts(queue_slot_id)`,
    `CREATE INDEX IF NOT EXISTS idx_post_targets_post ON post_targets(post_id)`,
    `CREATE INDEX IF NOT EXISTS idx_post_targets_status ON post_targets(status)`,
    `CREATE INDEX IF NOT EXISTS idx_queue_slots_day ON queue_slots(day_of_week, time)`,
    `CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring_rules(next_run_at)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_log_ts ON activity_log(timestamp DESC)`,
  ];
  await db.batch(statements.map(sql => ({ sql, args: [] })));
}

// ── Helpers ──

export function hashContent(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export async function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ── Activity Log ──

export async function logActivity(action, details = null, platformId = null) {
  const d = await getDb();
  await d.execute({
    sql: 'INSERT INTO activity_log (action, details, platform_id) VALUES (?, ?, ?)',
    args: [action, details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null, platformId],
  });
}

export async function getRecentLogs(limit = 50) {
  const d = await getDb();
  const rs = await d.execute({ sql: 'SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT ?', args: [limit] });
  return rs.rows;
}

// ── Platforms ──

export async function createPlatform(platform) {
  const d = await getDb();
  await d.execute({
    sql: 'INSERT INTO platforms (id, type, name, credentials, metadata, enabled) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      platform.id, platform.type, platform.name,
      JSON.stringify(platform.credentials),
      platform.metadata ? JSON.stringify(platform.metadata) : null,
      platform.enabled !== undefined ? (platform.enabled ? 1 : 0) : 1,
    ],
  });
  return platform.id;
}

export async function getPlatforms() {
  const d = await getDb();
  const rs = await d.execute('SELECT * FROM platforms ORDER BY created_at');
  return rs.rows.map(parsePlatformRow);
}

export async function getPlatform(id) {
  const d = await getDb();
  const rs = await d.execute({ sql: 'SELECT * FROM platforms WHERE id = ?', args: [id] });
  return rs.rows[0] ? parsePlatformRow(rs.rows[0]) : null;
}

export async function getPlatformsByType(type) {
  const d = await getDb();
  const rs = await d.execute({ sql: 'SELECT * FROM platforms WHERE type = ? AND enabled = 1', args: [type] });
  return rs.rows.map(parsePlatformRow);
}

export async function updatePlatform(id, data) {
  const d = await getDb();
  const fields = []; const values = [];
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.credentials !== undefined) { fields.push('credentials = ?'); values.push(JSON.stringify(data.credentials)); }
  if (data.metadata !== undefined) { fields.push('metadata = ?'); values.push(JSON.stringify(data.metadata)); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (fields.length === 0) return;
  values.push(id);
  await d.execute({ sql: `UPDATE platforms SET ${fields.join(', ')} WHERE id = ?`, args: values });
}

export async function deletePlatform(id) {
  const d = await getDb();
  await d.execute({ sql: 'DELETE FROM platforms WHERE id = ?', args: [id] });
}

function parsePlatformRow(row) {
  return {
    ...row,
    credentials: JSON.parse(row.credentials),
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    enabled: !!row.enabled,
  };
}

// ── Posts ──

export async function createPost(post) {
  const d = await getDb();
  const rs = await d.execute({
    sql: 'INSERT INTO posts (body, media, status, scheduled_at, recurring_rule_id, queue_slot_id) VALUES (?, ?, ?, ?, ?, ?)',
    args: [
      post.body,
      post.media ? JSON.stringify(post.media) : null,
      post.status || 'draft',
      post.scheduledAt || null,
      post.recurringRuleId || null,
      post.queueSlotId || null,
    ],
  });
  return Number(rs.lastInsertRowid);
}

export async function getPost(id) {
  const d = await getDb();
  const rs = await d.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [id] });
  return rs.rows[0] ? parsePostRow(rs.rows[0]) : null;
}

export async function getPosts({ status, limit = 50, offset = 0 } = {}) {
  const d = await getDb();
  let sql = 'SELECT * FROM posts';
  const args = [];
  if (status) { sql += ' WHERE status = ?'; args.push(status); }
  sql += ' ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);
  const rs = await d.execute({ sql, args });
  return rs.rows.map(parsePostRow);
}

export async function getScheduledPostsDue() {
  const d = await getDb();
  const now = new Date().toISOString();
  const rs = await d.execute({
    sql: "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC",
    args: [now],
  });
  return rs.rows.map(parsePostRow);
}

export async function getQueuedPosts(limit = 50) {
  const d = await getDb();
  const rs = await d.execute({
    sql: "SELECT * FROM posts WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?",
    args: [limit],
  });
  return rs.rows.map(parsePostRow);
}

export async function updatePost(id, data) {
  const d = await getDb();
  const fields = []; const values = [];
  if (data.body !== undefined) { fields.push('body = ?'); values.push(data.body); }
  if (data.media !== undefined) { fields.push('media = ?'); values.push(data.media ? JSON.stringify(data.media) : null); }
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.scheduledAt !== undefined) { fields.push('scheduled_at = ?'); values.push(data.scheduledAt); }
  if (data.postedAt !== undefined) { fields.push('posted_at = ?'); values.push(data.postedAt); }
  if (data.queueSlotId !== undefined) { fields.push('queue_slot_id = ?'); values.push(data.queueSlotId); }
  if (data.recurringRuleId !== undefined) { fields.push('recurring_rule_id = ?'); values.push(data.recurringRuleId); }
  fields.push('updated_at = ?'); values.push(new Date().toISOString());
  values.push(id);
  await d.execute({ sql: `UPDATE posts SET ${fields.join(', ')} WHERE id = ?`, args: values });
}

export async function deletePost(id) {
  const d = await getDb();
  await d.execute({ sql: 'DELETE FROM posts WHERE id = ?', args: [id] });
}

function parsePostRow(row) {
  return { ...row, media: row.media ? JSON.parse(row.media) : null };
}

// ── Post Targets ──

export async function createPostTarget(target) {
  const d = await getDb();
  const rs = await d.execute({
    sql: 'INSERT INTO post_targets (post_id, platform_id, status) VALUES (?, ?, ?)',
    args: [target.postId, target.platformId, target.status || 'pending'],
  });
  return Number(rs.lastInsertRowid);
}

export async function getPostTargets(postId) {
  const d = await getDb();
  const rs = await d.execute({
    sql: `SELECT pt.*, p.type as platform_type, p.name as platform_name
          FROM post_targets pt JOIN platforms p ON pt.platform_id = p.id
          WHERE pt.post_id = ?`,
    args: [postId],
  });
  return rs.rows;
}

export async function updatePostTarget(id, data) {
  const d = await getDb();
  const fields = []; const values = [];
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.platformPostId !== undefined) { fields.push('platform_post_id = ?'); values.push(data.platformPostId); }
  if (data.platformUrl !== undefined) { fields.push('platform_url = ?'); values.push(data.platformUrl); }
  if (data.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(data.errorMessage); }
  if (data.postedAt !== undefined) { fields.push('posted_at = ?'); values.push(data.postedAt); }
  if (fields.length === 0) return;
  values.push(id);
  await d.execute({ sql: `UPDATE post_targets SET ${fields.join(', ')} WHERE id = ?`, args: values });
}

// ── Post Overrides ──

export async function setPostOverride(postId, platformId, data) {
  const d = await getDb();
  await d.execute({
    sql: `INSERT INTO post_overrides (post_id, platform_id, body, media) VALUES (?, ?, ?, ?)
          ON CONFLICT(post_id, platform_id) DO UPDATE SET body = excluded.body, media = excluded.media`,
    args: [postId, platformId, data.body || null, data.media ? JSON.stringify(data.media) : null],
  });
}

export async function getPostOverrides(postId) {
  const d = await getDb();
  const rs = await d.execute({ sql: 'SELECT * FROM post_overrides WHERE post_id = ?', args: [postId] });
  return rs.rows.map(row => ({ ...row, media: row.media ? JSON.parse(row.media) : null }));
}

export async function deletePostOverride(postId, platformId) {
  const d = await getDb();
  await d.execute({ sql: 'DELETE FROM post_overrides WHERE post_id = ? AND platform_id = ?', args: [postId, platformId] });
}

// ── Media ──

export async function insertMedia(media) {
  const d = await getDb();
  await d.execute({
    sql: 'INSERT INTO media (id, filename, mime_type, size_bytes, path, url, width, height, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [media.id, media.filename, media.mimeType, media.sizeBytes || null, media.path, media.url || null, media.width || null, media.height || null, media.durationMs || null],
  });
  return media.id;
}

export async function getMedia(id) {
  const d = await getDb();
  const rs = await d.execute({ sql: 'SELECT * FROM media WHERE id = ?', args: [id] });
  return rs.rows[0] || null;
}

export async function deleteMedia(id) {
  const d = await getDb();
  await d.execute({ sql: 'DELETE FROM media WHERE id = ?', args: [id] });
}

// ── Queue Slots ──

export async function createQueueSlot(slot) {
  const d = await getDb();
  const rs = await d.execute({
    sql: 'INSERT INTO queue_slots (platform_id, day_of_week, time, timezone, enabled) VALUES (?, ?, ?, ?, ?)',
    args: [slot.platformId || null, slot.dayOfWeek, slot.time, slot.timezone || config.timezone, slot.enabled !== undefined ? (slot.enabled ? 1 : 0) : 1],
  });
  return Number(rs.lastInsertRowid);
}

export async function getQueueSlots() {
  const d = await getDb();
  const rs = await d.execute('SELECT * FROM queue_slots ORDER BY day_of_week, time');
  return rs.rows.map(row => ({ ...row, enabled: !!row.enabled }));
}

export async function updateQueueSlot(id, data) {
  const d = await getDb();
  const fields = []; const values = [];
  if (data.platformId !== undefined) { fields.push('platform_id = ?'); values.push(data.platformId); }
  if (data.dayOfWeek !== undefined) { fields.push('day_of_week = ?'); values.push(data.dayOfWeek); }
  if (data.time !== undefined) { fields.push('time = ?'); values.push(data.time); }
  if (data.timezone !== undefined) { fields.push('timezone = ?'); values.push(data.timezone); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (fields.length === 0) return;
  values.push(id);
  await d.execute({ sql: `UPDATE queue_slots SET ${fields.join(', ')} WHERE id = ?`, args: values });
}

export async function deleteQueueSlot(id) {
  const d = await getDb();
  await d.execute({ sql: 'DELETE FROM queue_slots WHERE id = ?', args: [id] });
}

// ── Recurring Rules ──

export async function createRecurringRule(rule) {
  const d = await getDb();
  const rs = await d.execute({
    sql: 'INSERT INTO recurring_rules (post_id, cron_expression, timezone, next_run_at, repeat_count, enabled) VALUES (?, ?, ?, ?, ?, ?)',
    args: [rule.postId, rule.cronExpression, rule.timezone || config.timezone, rule.nextRunAt || null, rule.repeatCount || 0, rule.enabled !== undefined ? (rule.enabled ? 1 : 0) : 1],
  });
  return Number(rs.lastInsertRowid);
}

export async function getRecurringRules() {
  const d = await getDb();
  const rs = await d.execute('SELECT * FROM recurring_rules ORDER BY created_at DESC');
  return rs.rows.map(row => ({ ...row, enabled: !!row.enabled }));
}

export async function getRecurringRulesDue() {
  const d = await getDb();
  const now = new Date().toISOString();
  const rs = await d.execute({
    sql: 'SELECT * FROM recurring_rules WHERE enabled = 1 AND next_run_at <= ?',
    args: [now],
  });
  return rs.rows.map(row => ({ ...row, enabled: !!row.enabled }));
}

export async function updateRecurringRule(id, data) {
  const d = await getDb();
  const fields = []; const values = [];
  if (data.cronExpression !== undefined) { fields.push('cron_expression = ?'); values.push(data.cronExpression); }
  if (data.timezone !== undefined) { fields.push('timezone = ?'); values.push(data.timezone); }
  if (data.nextRunAt !== undefined) { fields.push('next_run_at = ?'); values.push(data.nextRunAt); }
  if (data.lastRunAt !== undefined) { fields.push('last_run_at = ?'); values.push(data.lastRunAt); }
  if (data.runsCompleted !== undefined) { fields.push('runs_completed = ?'); values.push(data.runsCompleted); }
  if (data.repeatCount !== undefined) { fields.push('repeat_count = ?'); values.push(data.repeatCount); }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (fields.length === 0) return;
  values.push(id);
  await d.execute({ sql: `UPDATE recurring_rules SET ${fields.join(', ')} WHERE id = ?`, args: values });
}

export async function deleteRecurringRule(id) {
  const d = await getDb();
  await d.execute({ sql: 'DELETE FROM recurring_rules WHERE id = ?', args: [id] });
}

// ── Stats ──

export async function getPostStats() {
  const d = await getDb();
  const rs = await d.execute(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
      SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM posts
  `);
  return rs.rows[0];
}
