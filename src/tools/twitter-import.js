#!/usr/bin/env node
/**
 * Twitter Import Tool
 * Scrapes tweets from X/Twitter users via bird CLI and schedules them as Farcaster casts
 *
 * Usage:
 *   node src/tools/twitter-import.js --user=elonmusk --min-likes=1000 --interval=45
 *
 * Requires: bird CLI with authenticated Twitter cookies
 *   npx bird check  # to verify auth
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { config } from '../config.js';
import { getDb, schedulecast, getSigners } from '../db/sqlite.js';

// Check if content has already been scheduled or posted (by image URL or text)
function isDuplicate(imageUrl, text, signerUuid) {
  const db = getDb();
  // Check by image URL first (most reliable for image posts)
  if (imageUrl) {
    const byImage = db.prepare(`
      SELECT id FROM scheduled_casts
      WHERE image_url = ? AND signer_uuid = ?
      LIMIT 1
    `).get(imageUrl, signerUuid);
    if (byImage) return true;
  }
  // Also check by text for text-only posts
  if (text && text.length > 5) {
    const byText = db.prepare(`
      SELECT id FROM scheduled_casts
      WHERE text = ? AND signer_uuid = ?
      LIMIT 1
    `).get(text, signerUuid);
    if (byText) return true;
  }
  return false;
}

function fetchUserTweets(username, count = 20) {
  try {
    const result = execSync(
      `npx bird user-tweets "${username}" --count=${count} --json`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 60000,
        env: {
          ...process.env,
          AUTH_TOKEN: process.env.AUTH_TOKEN,
          CT0: process.env.CT0,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const data = JSON.parse(result);
    return data.tweets || data || [];
  } catch (err) {
    if (err.stderr) {
      throw new Error(`Bird CLI error: ${err.stderr}`);
    }
    throw err;
  }
}

function filterByEngagement(tweets, minLikes = 100, minRetweets = 0) {
  return tweets.filter(tweet => {
    const likes = tweet.likeCount || tweet.likes || tweet.favorite_count || tweet.favourites_count || 0;
    const retweets = tweet.retweetCount || tweet.retweets || tweet.retweet_count || 0;
    return likes >= minLikes && retweets >= minRetweets;
  });
}

function cleanTweetText(text) {
  if (!text) return '';
  // Remove t.co links
  let cleaned = text.replace(/https?:\/\/t\.co\/\w+/g, '').trim();
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');
  // Truncate if too long for Farcaster (320 chars)
  if (cleaned.length > 300) {
    cleaned = cleaned.slice(0, 297) + '...';
  }
  return cleaned;
}

function getRandomEmoji() {
  const emojis = [
    '🔥', '✨', '💫', '🌟', '⭐', '💎', '🎯', '🚀', '💯', '🎨',
    '📸', '🖼️', '👀', '👁️', '🤌', '💅', '🙌', '👏', '🤝', '💪',
    '🌈', '🎭', '🎪', '🎬', '📷', '🎞️', '🖌️', '✏️', '💭', '💬',
    '🤯', '😮', '😍', '🥹', '🫶', '❤️', '🧡', '💛', '💚', '💙',
  ];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

function extractImageUrl(tweet) {
  // Check for media/images in various formats
  const media = tweet.media || tweet.photos || tweet.images || [];
  if (Array.isArray(media) && media.length > 0) {
    const first = media[0];
    if (typeof first === 'string') return first;
    if (first.url) return first.url;
    if (first.media_url_https) return first.media_url_https;
    if (first.media_url) return first.media_url;
  }

  // Check extended_entities
  const extMedia = tweet.extended_entities?.media || tweet.entities?.media || [];
  for (const m of extMedia) {
    if (m.type === 'photo' && m.media_url_https) {
      return m.media_url_https;
    }
  }

  return null;
}

function scheduleTweets(tweets, intervalMinutes = 45, signerUuid = null) {
  const db = getDb();
  let scheduled = 0;
  let skippedDupes = 0;
  let startTime = new Date();
  startTime.setMinutes(startTime.getMinutes() + 1); // Start 1 minute from now

  for (const tweet of tweets) {
    let text = cleanTweetText(tweet.text || tweet.full_text || tweet.content || '');
    const imageUrl = extractImageUrl(tweet);

    // If no text but has image, use random emoji as caption
    if ((!text || text.length < 2) && imageUrl) {
      text = getRandomEmoji();
    }

    // Skip duplicates (check by image URL and text)
    if (isDuplicate(imageUrl, text, signerUuid)) {
      console.log(`  Skipping duplicate: ${imageUrl?.slice(-30) || text.slice(0, 30)}`);
      skippedDupes++;
      continue;
    }

    // Skip if still no content
    if (!text || text.length < 1) continue;

    const scheduledAt = new Date(startTime);

    // Schedule the cast
    const id = schedulecast(text, scheduledAt.toISOString(), imageUrl, signerUuid);
    console.log(`Scheduled #${id}: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" at ${scheduledAt.toLocaleTimeString()}${imageUrl ? ' [IMG]' : ''}`);

    scheduled++;
    startTime.setMinutes(startTime.getMinutes() + intervalMinutes);
  }

  if (skippedDupes > 0) {
    console.log(`Skipped ${skippedDupes} duplicate(s)`);
  }

  return scheduled;
}

async function importFromTwitter(options = {}) {
  const {
    username,
    count = 20,
    minLikes = 100,
    minRetweets = 0,
    intervalMinutes = 45,
    signerUuid = null,
    dryRun = false,
  } = options;

  if (!username) {
    throw new Error('Username is required');
  }

  console.log(`\nFetching tweets from @${username} via bird CLI...`);
  const tweets = fetchUserTweets(username, count);
  console.log(`Fetched ${tweets.length} tweets`);

  if (tweets.length === 0) {
    console.log('No tweets found');
    return { fetched: 0, filtered: 0, scheduled: 0 };
  }

  console.log(`\nFiltering by engagement (min ${minLikes} likes, ${minRetweets} RTs)...`);
  const filtered = filterByEngagement(tweets, minLikes, minRetweets);
  console.log(`${filtered.length} tweets meet criteria`);

  if (filtered.length === 0) {
    console.log('No tweets to import');
    return { fetched: tweets.length, filtered: 0, scheduled: 0 };
  }

  console.log('\nTweets to import:');
  filtered.forEach((tweet, i) => {
    const text = cleanTweetText(tweet.text || tweet.full_text || tweet.content || '');
    const likes = tweet.likeCount || tweet.likes || tweet.favorite_count || 0;
    const rts = tweet.retweetCount || tweet.retweets || tweet.retweet_count || 0;
    const hasImage = extractImageUrl(tweet) ? ' [IMG]' : '';
    console.log(`  ${i + 1}. (${likes} likes, ${rts} RTs)${hasImage} "${text.slice(0, 60)}..."`);
  });

  if (dryRun) {
    console.log('\n[DRY RUN] No casts scheduled');
    // Return tweet preview data for dashboard display
    const tweetPreviews = filtered.map(tweet => {
      let text = cleanTweetText(tweet.text || tweet.full_text || tweet.content || '');
      const imageUrl = extractImageUrl(tweet);
      // Show what will actually be posted (emoji for image-only)
      if ((!text || text.length < 2) && imageUrl) {
        text = '[random emoji]';
      }
      const isDupe = isDuplicate(imageUrl, text, signerUuid);
      return {
        text,
        likes: tweet.likeCount || tweet.likes || tweet.favorite_count || 0,
        retweets: tweet.retweetCount || tweet.retweets || tweet.retweet_count || 0,
        hasImage: !!imageUrl,
        imageUrl,
        isDuplicate: isDupe,
      };
    });
    const dupeCount = tweetPreviews.filter(t => t.isDuplicate).length;
    return { fetched: tweets.length, filtered: filtered.length, scheduled: 0, duplicates: dupeCount, tweets: tweetPreviews };
  }

  console.log(`\nScheduling ${filtered.length} casts (${intervalMinutes} min intervals)...`);
  const scheduled = scheduleTweets(filtered, intervalMinutes, signerUuid);

  console.log(`\nDone! Scheduled ${scheduled} casts`);
  return { fetched: tweets.length, filtered: filtered.length, scheduled };
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  for (const arg of args) {
    if (arg.startsWith('--user=')) {
      options.username = arg.split('=')[1];
    } else if (arg.startsWith('--count=')) {
      options.count = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--min-likes=')) {
      options.minLikes = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--min-rts=')) {
      options.minRetweets = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--interval=')) {
      options.intervalMinutes = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--signer=')) {
      options.signerUuid = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Twitter Import Tool - Scrape tweets and schedule as Farcaster casts

Requires bird CLI with authenticated Twitter cookies.
Run 'npx bird check' to verify your auth status.

Usage:
  node src/tools/twitter-import.js --user=USERNAME [options]

Options:
  --user=USERNAME      Twitter username to scrape (required)
  --count=N            Number of tweets to fetch (default: 20)
  --min-likes=N        Minimum likes to include (default: 100)
  --min-rts=N          Minimum retweets to include (default: 0)
  --interval=N         Minutes between scheduled casts (default: 45)
  --signer=UUID        Signer UUID to use (default: first configured)
  --dry-run            Preview without scheduling

Examples:
  npm run import-twitter -- --user=elonmusk --min-likes=5000 --interval=30
  npm run import-twitter -- --user=vitalikbuterin --min-likes=1000 --dry-run
`);
      process.exit(0);
    }
  }

  if (!options.username) {
    console.error('Error: --user=USERNAME is required');
    console.error('Run with --help for usage');
    process.exit(1);
  }

  // Default to first signer if not specified
  if (!options.signerUuid) {
    const signers = getSigners();
    options.signerUuid = config.neynarSignerUuids[0] || signers[0]?.signer_uuid || null;
  }

  try {
    await importFromTwitter(options);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Export for API use
export { importFromTwitter, fetchUserTweets, filterByEngagement };

// Run CLI if executed directly
const isMain = process.argv[1] && process.argv[1].endsWith('twitter-import.js');
if (isMain) {
  main();
}
