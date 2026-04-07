#!/usr/bin/env node
/**
 * Twitter Import Tool
 * Scrapes tweets from X/Twitter users via bird CLI and schedules them as posts.
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import {
  getDb, createPost, createPostTarget, getPlatforms, getPosts,
} from '../db/sqlite.js';

async function isDuplicate(imageUrl, text) {
  const posts = await getPosts({ limit: 500 });
  for (const p of posts) {
    if (text && text.length > 5 && p.body === text) return true;
    if (imageUrl && p.media) {
      const media = Array.isArray(p.media) ? p.media : [];
      if (media.some(m => m.url === imageUrl)) return true;
    }
  }
  return false;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchUserTweets(username, count = 20, retries = 3, startDate = null, endDate = null) {
  const safeCount = Math.min(count, 100);
  const useSearch = startDate || endDate;
  let command;
  if (useSearch) {
    let query = `from:${username}`;
    if (startDate) query += ` since:${startDate}`;
    if (endDate) query += ` until:${endDate}`;
    command = `npx bird search "${query}" --count=${safeCount} --json`;
  } else {
    command = `npx bird user-tweets "${username}" --count=${safeCount} --json`;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = execSync(command, {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120000,
        env: { ...process.env, AUTH_TOKEN: process.env.AUTH_TOKEN, CT0: process.env.CT0 },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(result);
      return data.tweets || data || [];
    } catch (err) {
      const errorMsg = err.stderr || err.message || '';
      if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit')) {
        if (attempt < retries) { await sleep(attempt * 30000); continue; }
        throw new Error('Rate limit exceeded.');
      }
      if (err.stderr) throw new Error(`Bird CLI error: ${err.stderr}`);
      throw err;
    }
  }
}

function filterByEngagement(tweets, minLikes = 100, minRetweets = 0) {
  return tweets.filter(t => {
    const likes = t.likeCount || t.likes || t.favorite_count || 0;
    const rts = t.retweetCount || t.retweets || t.retweet_count || 0;
    return likes >= minLikes && rts >= minRetweets;
  });
}

function cleanTweetText(text) {
  if (!text) return '';
  let cleaned = text.replace(/https?:\/\/t\.co\/\w+/g, '').trim().replace(/\s+/g, ' ');
  if (cleaned.length > 300) cleaned = cleaned.slice(0, 297) + '...';
  return cleaned;
}

function getRandomEmoji() {
  const emojis = ['🔥', '✨', '💫', '🌟', '⭐', '💎', '🎯', '🚀', '💯', '🎨'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

function hasVideo(tweet) {
  const media = tweet.media || tweet.photos || tweet.images || [];
  if (Array.isArray(media)) { for (const m of media) { if (m.type === 'video' || m.type === 'animated_gif') return true; } }
  const extMedia = tweet.extended_entities?.media || tweet.entities?.media || [];
  for (const m of extMedia) { if (m.type === 'video' || m.type === 'animated_gif') return true; }
  return !!(tweet.video_info || tweet.videos?.length > 0);
}

function extractImageUrl(tweet) {
  const media = tweet.media || tweet.photos || tweet.images || [];
  if (Array.isArray(media) && media.length > 0) {
    const first = media[0];
    if (first.type === 'video' || first.type === 'animated_gif') return null;
    if (typeof first === 'string') return first;
    return first.url || first.media_url_https || first.media_url || null;
  }
  const extMedia = tweet.extended_entities?.media || tweet.entities?.media || [];
  for (const m of extMedia) { if (m.type === 'photo' && m.media_url_https) return m.media_url_https; }
  return null;
}

async function scheduleContent(tweets, intervalMinutes = 45, platformIds = []) {
  await getDb();
  let scheduled = 0, skippedDupes = 0, skippedVideos = 0;
  let startTime = new Date();
  startTime.setMinutes(startTime.getMinutes() + 1);

  for (const tweet of tweets) {
    if (hasVideo(tweet)) { skippedVideos++; continue; }
    let text = cleanTweetText(tweet.text || tweet.full_text || tweet.content || '');
    const imageUrl = extractImageUrl(tweet);
    if ((!text || text.length < 2) && imageUrl) text = getRandomEmoji();
    if (await isDuplicate(imageUrl, text)) { skippedDupes++; continue; }
    if (!text || text.length < 1) continue;

    const scheduledAt = new Date(startTime);
    const media = imageUrl ? [{ url: imageUrl, type: 'image' }] : null;
    const postId = await createPost({ body: text, media, status: 'scheduled', scheduledAt: scheduledAt.toISOString() });
    for (const pid of platformIds) { await createPostTarget({ postId, platformId: pid }); }

    console.log(`Scheduled post #${postId}: "${text.slice(0, 50)}..." at ${scheduledAt.toLocaleTimeString()}${imageUrl ? ' [IMG]' : ''}`);
    scheduled++;
    startTime.setMinutes(startTime.getMinutes() + intervalMinutes);
  }
  return { scheduled, skippedDupes, skippedVideos };
}

export async function importFromTwitter(options = {}) {
  const { username, count = 20, minLikes = 100, minRetweets = 0, intervalMinutes = 45, dryRun = false, platforms: targetPlatformIds = null, startDate = null, endDate = null } = options;
  if (!username) throw new Error('Username is required');

  await getDb();
  let platformIds = targetPlatformIds;
  if (!platformIds) { platformIds = (await getPlatforms()).filter(p => p.enabled).map(p => p.id); }

  console.log(`\nFetching tweets from @${username}...`);
  const tweets = await fetchUserTweets(username, count, 3, startDate, endDate);
  console.log(`Fetched ${tweets.length} tweets`);
  if (tweets.length === 0) return { fetched: 0, filtered: 0, scheduled: 0, skippedVideos: 0 };

  let filtered = filterByEngagement(tweets, minLikes, minRetweets);
  const withoutVideos = filtered.filter(t => !hasVideo(t));
  const videoCount = filtered.length - withoutVideos.length;
  filtered = withoutVideos;
  if (filtered.length === 0) return { fetched: tweets.length, filtered: 0, scheduled: 0, skippedVideos: videoCount };

  if (dryRun) { console.log('[DRY RUN]'); return { fetched: tweets.length, filtered: filtered.length, scheduled: 0 }; }

  const result = await scheduleContent(filtered, intervalMinutes, platformIds);
  console.log(`Done! Scheduled ${result.scheduled} posts`);
  return { fetched: tweets.length, filtered: filtered.length, ...result };
}

export async function searchTweets(query, count = 10, minLikes = 0) {
  const fetchCount = minLikes > 0 ? Math.min(count * 10, 100) : Math.min(count, 50);
  try {
    const result = execSync(`npx bird search "${query}" --count=${fetchCount} --json`, {
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 120000,
      env: { ...process.env, AUTH_TOKEN: process.env.AUTH_TOKEN, CT0: process.env.CT0 },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let tweets = JSON.parse(result).tweets || JSON.parse(result) || [];
    if (minLikes > 0) tweets = tweets.filter(t => (t.likeCount || t.likes || 0) >= minLikes);
    tweets.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
    return tweets.slice(0, count).map(t => ({
      id: t.id, text: t.text || t.full_text || '',
      likeCount: t.likeCount || t.likes || 0, retweetCount: t.retweetCount || t.retweets || 0,
      imageUrl: extractImageUrl(t), hasVideo: hasVideo(t),
    }));
  } catch (err) {
    if ((err.stderr || '').includes('429')) throw new Error('Rate limit exceeded.');
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--user=')) options.username = arg.split('=')[1];
    else if (arg.startsWith('--count=')) options.count = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--min-likes=')) options.minLikes = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--interval=')) options.intervalMinutes = parseInt(arg.split('=')[1], 10);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--from=')) options.startDate = arg.split('=')[1];
    else if (arg.startsWith('--to=')) options.endDate = arg.split('=')[1];
    else if (arg === '--help') { console.log('Usage: --user=USERNAME [--count=N] [--min-likes=N] [--interval=N] [--dry-run]'); process.exit(0); }
  }
  if (!options.username) { console.error('--user=USERNAME required'); process.exit(1); }
  try { await importFromTwitter(options); } catch (err) { console.error(err.message); process.exit(1); }
}

if (process.argv[1]?.endsWith('twitter-import.js')) main();
