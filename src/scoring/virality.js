import { config } from '../config.js';

// Authority tier thresholds for Farcaster (lower follower counts than Twitter)
const AUTHORITY_TIERS = [
  { minFollowers: 100000, score: 20 },
  { minFollowers: 50000, score: 15 },
  { minFollowers: 10000, score: 10 },
  { minFollowers: 1000, score: 5 },
  { minFollowers: 0, score: 1 },
];

// Velocity thresholds (engagement per hour) - adjusted for Farcaster
const VELOCITY_TIERS = [
  { minVelocity: 1000, score: 20 },
  { minVelocity: 100, score: 15 },
  { minVelocity: 50, score: 10 },
  { minVelocity: 10, score: 5 },
  { minVelocity: 0, score: 1 },
];

// Popular channels get bonus points
const POPULAR_CHANNELS = ['base', 'degen', 'farcaster', 'memes', 'crypto', 'ethereum'];

// Calculate engagement score (max 40 points)
// Recasts are weighted higher on Farcaster (smaller network, more valuable)
function calculateEngagementScore(likes, recasts, replies) {
  const weightedEngagement = likes + recasts * 4 + replies * 2;
  const score = Math.log10(weightedEngagement + 1) * 12;
  return Math.min(40, score);
}

// Calculate authority score based on follower count (max 20 points)
function calculateAuthorityScore(followers) {
  for (const tier of AUTHORITY_TIERS) {
    if (followers >= tier.minFollowers) {
      return tier.score;
    }
  }
  return 1;
}

// Calculate tracked account boost multiplier
function calculateTrackedAccountBoost(authorHandle) {
  const handle = (authorHandle || '').toLowerCase();
  const trackedLower = config.trackedAccounts.map((a) => a.toLowerCase());

  if (trackedLower.includes(handle)) {
    return config.accountBoostMultiplier || 1.5;
  }
  return 1.0;
}

// Calculate channel bonus (max 5 points)
function calculateChannelBonus(channel) {
  if (!channel) return 0;

  const channelLower = channel.toLowerCase();

  // Check if channel is tracked
  if (config.trackedChannels.map((c) => c.toLowerCase()).includes(channelLower)) {
    return 5;
  }

  // Check if channel is generally popular
  if (POPULAR_CHANNELS.includes(channelLower)) {
    return 3;
  }

  return 0;
}

// Parse date string to timestamp
function parseDate(dateStr) {
  if (!dateStr) return Date.now();

  // Try ISO format first
  const timestamp = new Date(dateStr).getTime();
  if (!isNaN(timestamp)) return timestamp;

  return Date.now(); // Fallback to now
}

// Calculate velocity score (engagement per hour) (max 20 points)
function calculateVelocityScore(likes, recasts, replies, createdAt) {
  const timestamp = parseDate(createdAt);
  const ageHours = Math.max(0.1, (Date.now() - timestamp) / (1000 * 60 * 60));
  const totalEngagement = likes + recasts + replies;
  const velocity = totalEngagement / ageHours;

  for (const tier of VELOCITY_TIERS) {
    if (velocity >= tier.minVelocity) {
      return tier.score;
    }
  }
  return 1;
}

// Calculate keyword match score (max 10 points)
function calculateKeywordScore(text, keywordMatch) {
  let score = 0;
  const lowerText = (text || '').toLowerCase();

  // Base score for having a keyword match
  if (keywordMatch) {
    score += 5;

    // Bonus for word boundary match
    const regex = new RegExp(`\\b${keywordMatch.toLowerCase()}\\b`);
    if (regex.test(lowerText)) {
      score += 2;
    }
  }

  // Additional points for multiple keyword matches
  for (const keyword of config.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 1;
    }
  }

  return Math.min(10, score);
}

// Calculate spread score based on mentions of tracked accounts (max 10 points)
function calculateSpreadScore(text) {
  let score = 0;
  const lowerText = (text || '').toLowerCase();

  for (const account of config.trackedAccounts) {
    if (lowerText.includes(`@${account.toLowerCase()}`)) {
      score += 3;
    }
  }

  // Bonus for multiple @ mentions in general
  const mentionCount = (text?.match(/@\w+/g) || []).length;
  score += Math.min(4, mentionCount);

  return Math.min(10, score);
}

// Calculate decay multiplier based on age (6-hour half-life)
function calculateDecayMultiplier(createdAt) {
  const timestamp = parseDate(createdAt);
  const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
  const halfLife = 6; // hours
  return Math.max(0.5, Math.exp((-Math.log(2) / halfLife) * ageHours));
}

// Calculate total virality score (0-100+ scale with boosts)
export function calculateViralityScore(cast) {
  // Handle both camelCase (from parser) and snake_case (from DB)
  const likes = cast.likeCount || cast.like_count || 0;
  const recasts = cast.recastCount || cast.recast_count || 0;
  const replies = cast.replyCount || cast.reply_count || 0;
  const followers = cast.authorFollowers || cast.author_followers || 0;
  const createdAt = cast.createdAt || cast.created_at;
  const keywordMatch = cast.keywordMatch || cast.keyword_match;
  const authorHandle = cast.authorHandle || cast.author_handle || '';
  const channel = cast.channel || null;

  const engagement = calculateEngagementScore(likes, recasts, replies);
  const authority = calculateAuthorityScore(followers);
  const velocity = calculateVelocityScore(likes, recasts, replies, createdAt);
  const keywords = calculateKeywordScore(cast.text, keywordMatch);
  const spread = calculateSpreadScore(cast.text);
  const channelBonus = calculateChannelBonus(channel);

  // Sum raw score (max ~105 without boosts)
  const rawScore = engagement + authority + velocity + keywords + spread + channelBonus;

  // Apply tracked account boost
  const accountBoost = calculateTrackedAccountBoost(authorHandle);
  const boostedScore = rawScore * accountBoost;

  // Apply decay multiplier
  const decayMultiplier = calculateDecayMultiplier(createdAt);
  const finalScore = boostedScore * decayMultiplier;

  return {
    total: Math.round(finalScore * 100) / 100,
    breakdown: {
      engagement: Math.round(engagement * 100) / 100,
      authority,
      velocity,
      keywords,
      spread,
      channelBonus,
      accountBoost: Math.round(accountBoost * 100) / 100,
      decayMultiplier: Math.round(decayMultiplier * 100) / 100,
    },
  };
}

// Check if score meets threshold
export function meetsThreshold(score, threshold = config.viralityThreshold) {
  return score >= threshold;
}
