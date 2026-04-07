import 'dotenv/config';

export const config = {
  // Farcaster (Neynar)
  neynarApiKey: process.env.NEYNAR_API_KEY || '',
  neynarSignerUuids: (process.env.FARCASTER_SIGNER_UUIDS || process.env.FARCASTER_SIGNER_UUID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  neynarClientId: process.env.NEYNAR_CLIENT_ID || '',

  // Twitter/X (bird CLI)
  twitterAuthToken: process.env.AUTH_TOKEN || '',
  twitterCt0: process.env.CT0 || '',

  // Database (Turso remote or local file)
  dbUrl: process.env.TURSO_DATABASE_URL || `file:${new URL('../data/net.db', import.meta.url).pathname}`,
  dbAuthToken: process.env.TURSO_AUTH_TOKEN || '',

  // Server
  port: parseInt(process.env.PORT || '3000', 10),

  // Media uploads
  uploadsDir: process.env.UPLOADS_DIR || new URL('../data/uploads', import.meta.url).pathname,

  // Timezone (for queue slots and recurring rules)
  timezone: process.env.TZ || 'UTC',

  // Scheduler
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '15000', 10),
  minPostIntervalMs: parseInt(process.env.MIN_POST_INTERVAL_MS || '60000', 10),
};
