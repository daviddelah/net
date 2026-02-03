import { config } from '../config.js';

const NEYNAR_BASE_URL = 'https://api.neynar.com/v2/farcaster';

// In-memory FID cache
const fidCache = new Map();

// Rate limiter state
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 200; // 200ms between requests (300/min limit)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rate-limited fetch wrapper
async function rateLimitedFetch(url, options) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - elapsed);
  }
  lastRequestTime = Date.now();
  return fetch(url, options);
}

// Make Neynar API request with retry logic
async function neynarFetch(endpoint, params = {}, retries = 3) {
  if (!config.neynarApiKey) {
    throw new Error('NEYNAR_API_KEY is required');
  }

  const url = new URL(`${NEYNAR_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  });

  let lastError;
  const backoffs = [1000, 2000, 4000];

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await rateLimitedFetch(url.toString(), {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'x-api-key': config.neynarApiKey,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Neynar API error ${response.status}: ${errorBody}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      const isRetryable = err.message.includes('429') || err.message.includes('500');

      if (isRetryable && attempt < retries - 1) {
        const backoffMs = backoffs[attempt];
        console.log(`Neynar API error, retrying in ${backoffMs / 1000}s: ${err.message}`);
        await sleep(backoffMs);
      } else if (!isRetryable) {
        break;
      }
    }
  }

  throw lastError;
}

// Normalize Neynar cast to internal format
function normalizeCast(cast, source, extras = {}) {
  return {
    castHash: cast.hash,
    text: cast.text || '',
    authorFid: cast.author?.fid || 0,
    authorHandle: cast.author?.username || '',
    authorFollowers: cast.author?.follower_count || 0,
    replyCount: cast.replies?.count || 0,
    recastCount: cast.reactions?.recasts_count || 0,
    likeCount: cast.reactions?.likes_count || 0,
    createdAt: cast.timestamp || new Date().toISOString(),
    source,
    channel: cast.channel?.id || extras.channel || null,
    keywordMatch: extras.keywordMatch || null,
  };
}

// Look up user FID by username with caching
export async function lookupUserFid(username) {
  // Check cache first
  if (fidCache.has(username.toLowerCase())) {
    return fidCache.get(username.toLowerCase());
  }

  try {
    const data = await neynarFetch('/user/by_username', { username });
    const user = data.user;

    if (user) {
      const userInfo = {
        fid: user.fid,
        followerCount: user.follower_count || 0,
      };
      fidCache.set(username.toLowerCase(), userInfo);
      return userInfo;
    }
  } catch (err) {
    console.error(`Failed to look up FID for @${username}: ${err.message}`);
  }

  return null;
}

// Fetch trending casts globally
export async function fetchTrendingCasts(limit = 10) {
  try {
    // Neynar limits trending feed to max 10 per request
    const data = await neynarFetch('/feed/trending', {
      limit: Math.min(limit, 10),
      time_window: '24h',
    });

    const casts = data.casts || [];
    return casts.map((cast) => normalizeCast(cast, 'trending'));
  } catch (err) {
    console.error(`Failed to fetch trending casts: ${err.message}`);
    return [];
  }
}

// Fetch casts from tracked accounts
export async function fetchAccountCasts(accounts = config.trackedAccounts, limit = 10) {
  const allCasts = [];

  for (const account of accounts) {
    try {
      // Look up FID
      const userInfo = await lookupUserFid(account);
      if (!userInfo) {
        console.error(`Could not find FID for @${account}`);
        continue;
      }

      const data = await neynarFetch('/feed/user/casts', {
        fid: userInfo.fid,
        limit,
        include_replies: false,
      });

      const casts = data.casts || [];
      const normalizedCasts = casts.map((cast) => normalizeCast(cast, 'account'));
      allCasts.push(...normalizedCasts);
    } catch (err) {
      console.error(`Failed to fetch casts for @${account}: ${err.message}`);
    }
  }

  return allCasts;
}

// Fetch casts from tracked channels
export async function fetchChannelCasts(channels = config.trackedChannels, limit = 10) {
  const allCasts = [];

  for (const channel of channels) {
    try {
      // Neynar limits trending feed to max 10 per request
      const data = await neynarFetch('/feed/trending', {
        limit: Math.min(limit, 10),
        time_window: '24h',
        channel_id: channel,
      });

      const casts = data.casts || [];
      const normalizedCasts = casts.map((cast) => normalizeCast(cast, 'channel', { channel }));
      allCasts.push(...normalizedCasts);
    } catch (err) {
      console.error(`Failed to fetch casts from /${channel}: ${err.message}`);
    }
  }

  return allCasts;
}

// Search for keyword matches
export async function searchKeywords(keywords = config.keywords, limit = 10) {
  const allCasts = [];

  for (const keyword of keywords) {
    try {
      const data = await neynarFetch('/cast/search', {
        q: keyword,
        limit,
      });

      const casts = data.result?.casts || [];
      const normalizedCasts = casts.map((cast) =>
        normalizeCast(cast, 'search', { keywordMatch: keyword })
      );
      allCasts.push(...normalizedCasts);
    } catch (err) {
      console.error(`Failed to search for "${keyword}": ${err.message}`);
    }
  }

  return allCasts;
}

// Fetch all casts from all sources
export async function fetchAllCasts() {
  const [trending, accountCasts, channelCasts, searchResults] = await Promise.all([
    fetchTrendingCasts(),
    fetchAccountCasts(),
    fetchChannelCasts(),
    searchKeywords(),
  ]);

  // Combine all casts
  const allCasts = [...trending, ...accountCasts, ...channelCasts, ...searchResults];

  // Deduplicate by cast hash
  const seen = new Set();
  const uniqueCasts = allCasts.filter((cast) => {
    if (!cast.castHash || seen.has(cast.castHash)) {
      return false;
    }
    seen.add(cast.castHash);
    return true;
  });

  return uniqueCasts;
}
