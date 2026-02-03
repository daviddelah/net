import 'dotenv/config';

export const config = {
  // Neynar (Farcaster)
  neynarApiKey: process.env.NEYNAR_API_KEY || '',
  neynarSignerUuids: (process.env.FARCASTER_SIGNER_UUIDS || process.env.FARCASTER_SIGNER_UUID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  neynarClientId: process.env.NEYNAR_CLIENT_ID || '',

  // Farcaster monitoring
  trackedAccounts: (process.env.TRACKED_ACCOUNTS || 'dwr,vitalik.eth,jessepollak').split(',').map(a => a.trim()),
  accountBoostMultiplier: parseFloat(process.env.ACCOUNT_BOOST_MULTIPLIER || '1.5'),
  trackedChannels: (process.env.TRACKED_CHANNELS || 'base,degen,farcaster').split(',').map(c => c.trim()),
  keywords: (process.env.KEYWORDS || 'memecoin,airdrop,launch').split(',').map(k => k.trim()),

  // Timing
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '120000', 10),
  launchCooldownMs: parseInt(process.env.LAUNCH_COOLDOWN_MS || '300000', 10),

  // Thresholds
  viralityThreshold: parseInt(process.env.VIRALITY_THRESHOLD || '70', 10),
  maxLaunchesPerDay: parseInt(process.env.MAX_LAUNCHES_PER_DAY || '10', 10),

  // Dexscreener (trending pairs)
  dexscreenerEnabled: (process.env.DEXSCREENER_ENABLED || 'true') === 'true',
  dexscreenerMaxPairs: parseInt(process.env.DEXSCREENER_MAX_PAIRS || '30', 10),
  dexscreenerMaxAgeMinutes: parseInt(process.env.DEXSCREENER_MAX_AGE_MINUTES || '30', 10),
  dexscreenerMinVolumeM5: parseFloat(process.env.DEXSCREENER_MIN_VOLUME_M5 || '20000'),
  dexscreenerMinTrendingScore: parseFloat(
    process.env.DEXSCREENER_MIN_TRENDING_SCORE || '0'
  ),
  dexscreenerExcludedChains: (process.env.DEXSCREENER_EXCLUDED_CHAINS || 'base')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean),

  // Database
  dbPath: process.env.DB_PATH || new URL('../data/launches.db', import.meta.url).pathname,

  // Dashboard
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
};
