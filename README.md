# Trend2Token

Monitor Farcaster for viral trends and automatically deploy memecoins via Clanker.

## Features

- **Farcaster Monitoring** - Polls trending casts, tracked accounts, channels, and keyword searches using the Neynar API
- **Virality Scoring** - Scores casts based on engagement, authority, velocity, keywords, and channel popularity
- **Account Boost** - Tracked accounts get a configurable score multiplier
- **Token Name Generation** - Extracts keywords and generates catchy token names with tickers
- **Duplicate Prevention** - Internal tracking to avoid deploying duplicate tokens
- **Clanker Deployment** - Posts to Farcaster tagging @clanker to deploy tokens
- **Web Dashboard** - Real-time monitoring with pause/resume and threshold controls
- **Activity Logging** - Full audit trail of all actions

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# Neynar (Farcaster) API
NEYNAR_API_KEY=your_neynar_api_key
FARCASTER_SIGNER_UUID=your_signer_uuid
FARCASTER_SIGNER_UUIDS=uuid_1,uuid_2
NEYNAR_CLIENT_ID=your_neynar_client_id

# Farcaster monitoring
TRACKED_ACCOUNTS=dwr,vitalik.eth,jessepollak
ACCOUNT_BOOST_MULTIPLIER=1.5
TRACKED_CHANNELS=base,degen,farcaster,memes
KEYWORDS=memecoin,airdrop,launch,token

# Timing
POLL_INTERVAL_MS=120000
LAUNCH_COOLDOWN_MS=300000

# Thresholds
VIRALITY_THRESHOLD=40
MAX_LAUNCHES_PER_DAY=10

# Dexscreener (trending pairs)
DEXSCREENER_ENABLED=true
DEXSCREENER_WS_URL=wss://io.dexscreener.com/dex/screener/pairs/h24/1?rankBy[key]=trendingScoreM5&rankBy[order]=desc
DEXSCREENER_WS_TIMEOUT_MS=8000
DEXSCREENER_MAX_PAIRS=30
DEXSCREENER_MAX_AGE_MINUTES=30
DEXSCREENER_MIN_VOLUME_M5=20000
DEXSCREENER_MIN_TRENDING_SCORE=0
DEXSCREENER_EXCLUDED_CHAINS=base
```

## Usage

### Start the monitor

```bash
npm start
```

### Start the dashboard

```bash
npm run dashboard
```

Then open http://localhost:3000 in your browser.

### CLI Commands

```bash
npm run status    # Show today's status and recent launches
npm run trends    # List recent casts with scores
npm run launches  # List token launches
npm run stats     # View historical statistics
```

## API Endpoints

- `GET /api/stats` - Dashboard stats and configuration
- `GET /api/trends` - Current trending casts and scores
- `GET /api/launches` - Launched tokens history
- `GET /api/logs` - Recent activity log
- `GET /api/history` - Historical stats
- `POST /api/config` - Update threshold and pause/resume

## Monitoring Sources

1. **Trending** - Global trending casts from Farcaster
2. **Accounts** - Casts from tracked high-profile accounts
3. **Channels** - Trending casts from tracked channels
4. **Search** - Keyword search results
5. **Dexscreener** - Trending new pairs (5m) filtered by volume, recency, and chain

## Scoring Algorithm

Each cast is scored on a 0-100+ scale:

- **Engagement** (max 40): Likes + recasts×4 + replies×2 (log scale)
- **Authority** (max 20): Based on author follower count
- **Velocity** (max 20): Engagement per hour since posting
- **Keywords** (max 10): Matched keyword count
- **Spread** (max 10): Mentions of tracked accounts
- **Channel Bonus** (max 5): Posts in popular/tracked channels
- **Account Boost** (×1.5 default): Multiplier for tracked accounts
- **Decay Multiplier**: 6-hour half-life for freshness

## File Structure

```
/src
  /monitors
    farcaster.js    # Neynar API polling
  /scoring
    virality.js     # Scoring algorithm
  /generation
    tokenName.js    # Keyword extraction + templates
  /checks
    internal.js     # Internal duplicate checking
  /deployment
    farcaster.js    # Post tagging @clanker
  /db
    sqlite.js       # Database operations
  /dashboard
    server.js       # Express API endpoints
    index.html      # Web dashboard
  /cli
    status.js       # Status command
    trends.js       # Trends command
    launches.js     # Launches command
    stats.js        # Stats command
  index.js          # Main orchestration loop
  config.js         # Configuration
/data
  launches.db       # SQLite database
```

## License

MIT
