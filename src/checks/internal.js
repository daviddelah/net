import { getDb } from '../db/sqlite.js';

// Check if a token ticker already exists in our launched tokens
export function tickerExists(ticker, signerUuid = null) {
  const db = getDb();
  const row = signerUuid
    ? db
        .prepare(
          'SELECT 1 FROM launched_tokens WHERE UPPER(token_ticker) = ? AND signer_uuid = ?'
        )
        .get(ticker.toUpperCase(), signerUuid)
    : db.prepare('SELECT 1 FROM launched_tokens WHERE UPPER(token_ticker) = ?').get(
        ticker.toUpperCase()
      );
  return !!row;
}

// Check if a similar token name exists (fuzzy match)
export function similarNameExists(tokenName, signerUuid = null) {
  const db = getDb();
  const normalizedName = tokenName.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normalizedName.length < 3) {
    return false;
  }

  // Check for exact or similar names
  const rows = signerUuid
    ? db
        .prepare(
          `SELECT token_name FROM launched_tokens
           WHERE LOWER(REPLACE(REPLACE(token_name, ' ', ''), '-', '')) LIKE ?
           AND signer_uuid = ?`
        )
        .all(`%${normalizedName}%`, signerUuid)
    : db
        .prepare(
          `SELECT token_name FROM launched_tokens
           WHERE LOWER(REPLACE(REPLACE(token_name, ' ', ''), '-', '')) LIKE ?`
        )
        .all(`%${normalizedName}%`);

  return rows.length > 0;
}

// Combined duplicate check
export function tokenExists(tokenName, ticker, signerUuid = null) {
  return tickerExists(ticker, signerUuid) || similarNameExists(tokenName, signerUuid);
}

// Get all launched tokens (for debugging/dashboard)
export function getLaunchedTokens(limit = 100) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM launched_tokens ORDER BY launched_at DESC LIMIT ?`
  ).all(limit);
}
