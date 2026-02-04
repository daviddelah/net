import { config } from './config.js';
import {
  getDb,
  hashContent,
  isContentSeen,
  markContentSeen,
  insertTrend,
  updateTrendScore,
  getUnprocessedTrends,
  getTopScoredTrend,
  markTrendLaunched,
  markTrendRejected,
  getTodayStats,
  incrementDailyStat,
  logActivity,
  closeDb,
  queueToken,
} from './db/sqlite.js';
import { fetchAllCasts } from './monitors/farcaster.js';
import { fetchDexscreenerPairs } from './monitors/dexscreener.js';
import { fetchPumpFunGraduated } from './monitors/pumpfun.js';
import { calculateViralityScore, meetsThreshold } from './scoring/virality.js';
import { tokenExists } from './checks/internal.js';
import { generateTokenName, generateFallbackName } from './generation/tokenName.js';

let isRunning = false;
const defaultSignerUuid = config.neynarSignerUuids[0] || null;

async function processCasts(casts) {
  let newTrends = 0;

  for (const cast of casts) {
    // Skip if no cast hash
    if (!cast.castHash) continue;

    // Deduplicate by content hash
    const contentHash = hashContent(cast.text);
    if (isContentSeen(contentHash)) {
      continue;
    }

    // Mark as seen
    markContentSeen(contentHash, cast.source);

    // Insert into trends table
    const trendId = insertTrend(cast);
    if (trendId) {
      newTrends++;
      incrementDailyStat('trends_detected', defaultSignerUuid);
    }
  }

  return newTrends;
}

async function scoreTrends() {
  const unprocessed = getUnprocessedTrends();
  let aboveThreshold = 0;

  for (const trend of unprocessed) {
    const { total, breakdown } = calculateViralityScore(trend);

    const boostStr = breakdown.accountBoost > 1 ? ` B:${breakdown.accountBoost}x` : '';
    const channelStr = breakdown.channelBonus > 0 ? ` Ch:${breakdown.channelBonus}` : '';

    console.log(
      `Scored @${trend.author_handle}: ${total.toFixed(1)} ` +
        `(E:${breakdown.engagement.toFixed(1)} A:${breakdown.authority} ` +
        `V:${breakdown.velocity} K:${breakdown.keywords} S:${breakdown.spread}${channelStr}${boostStr})`
    );

    updateTrendScore(trend.id, total);

    if (meetsThreshold(total)) {
      aboveThreshold++;
      incrementDailyStat('trends_above_threshold', defaultSignerUuid);
    }
  }

  return { scored: unprocessed.length, aboveThreshold };
}

// Queue a token for review instead of auto-launching
async function queueTokenForReview() {
  // Get top scoring trend above threshold
  const trend = getTopScoredTrend(config.viralityThreshold);
  if (!trend) {
    return null;
  }

  console.log(`\nTop trend (score ${trend.virality_score.toFixed(1)}): "${trend.text.slice(0, 80)}..."`);

  // Generate token name
  let tokenInfo;
  try {
    tokenInfo = generateTokenName(trend.text, trend.author_handle);
    console.log(`Generated: ${tokenInfo.name} ($${tokenInfo.ticker})`);
  } catch (err) {
    console.error(`Token name generation failed: ${err.message}`);
    tokenInfo = generateFallbackName(trend.text);
    console.log(`Using fallback: ${tokenInfo.name} ($${tokenInfo.ticker})`);
  }

  // Check if token already exists (internal duplicate check)
  const exists = tokenExists(tokenInfo.name, tokenInfo.ticker, defaultSignerUuid);
  if (exists) {
    console.log(`Token $${tokenInfo.ticker} already exists, skipping`);
    logActivity(
      'token_duplicate',
      { ticker: tokenInfo.ticker, name: tokenInfo.name },
      defaultSignerUuid
    );
    markTrendRejected(trend.id);
    return null;
  }

  // Build the default cast text
  const castText = `@clanker deploy $${tokenInfo.ticker} "${tokenInfo.name}"`;

  // Build source cast URL (Warpcast format)
  const sourceCastUrl = trend.cast_hash
    ? `https://warpcast.com/${trend.author_handle}/${trend.cast_hash.slice(0, 10)}`
    : null;

  // Queue the token for review
  const queueId = queueToken({
    trendId: trend.id,
    signerUuid: defaultSignerUuid,
    tokenName: tokenInfo.name,
    tokenTicker: tokenInfo.ticker,
    castText,
    imageUrl: null,
    sourceCastHash: trend.cast_hash,
    sourceCastUrl,
    sourceAuthor: trend.author_handle,
    sourceText: trend.text,
    viralityScore: trend.virality_score,
  });

  // Mark trend as processed (queued)
  markTrendLaunched(trend.id);

  console.log(`QUEUED for review: $${tokenInfo.ticker} - ${tokenInfo.name} (Queue ID: ${queueId})`);

  logActivity('token_queued', {
    queueId,
    ticker: tokenInfo.ticker,
    name: tokenInfo.name,
    score: trend.virality_score,
    sourceAuthor: trend.author_handle,
  }, defaultSignerUuid);

  return { queueId, tokenInfo };
}

async function runCycle() {
  const cycleStart = Date.now();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toISOString()}] Starting monitoring cycle`);

  try {
    // Fetch casts from all sources
    console.log('\nFetching Farcaster casts...');
    const [casts, dexPairs, pumpfunTokens] = await Promise.all([
      fetchAllCasts(),
      fetchDexscreenerPairs(),
      fetchPumpFunGraduated(),
    ]);
    const allTrends = [...casts, ...dexPairs, ...pumpfunTokens];
    console.log(`Fetched ${casts.length} casts, ${dexPairs.length} Dexscreener pairs, ${pumpfunTokens.length} pump.fun graduated`);

    logActivity(
      'fetch_complete',
      { count: allTrends.length, casts: casts.length, dexPairs: dexPairs.length },
      defaultSignerUuid
    );

    // Process and deduplicate
    const newTrends = await processCasts(allTrends);
    console.log(`Added ${newTrends} new trends`);

    // Score unprocessed trends
    const { scored, aboveThreshold } = await scoreTrends();
    console.log(`Scored ${scored} trends, ${aboveThreshold} above threshold`);

    // Queue tokens for review if we have good candidates
    if (aboveThreshold > 0) {
      await queueTokenForReview();
    }

    // Log daily stats
    const stats = getTodayStats(defaultSignerUuid);
    console.log(
      `\nToday: ${stats.trends_detected} detected, ` +
        `${stats.trends_above_threshold} viral, ` +
        `${stats.launches_count}/${config.maxLaunchesPerDay} launched`
    );
  } catch (err) {
    console.error(`Cycle error: ${err.message}`);
    logActivity('cycle_error', { error: err.message }, defaultSignerUuid);
  }

  const elapsed = Date.now() - cycleStart;
  console.log(`Cycle completed in ${(elapsed / 1000).toFixed(1)}s`);
}

async function main() {
  console.log('Trend2Token - Farcaster Viral Trend Monitor & Token Deployer');
  console.log('='.repeat(60));
  console.log(`Tracking accounts: ${config.trackedAccounts.join(', ')}`);
  console.log(`Tracking channels: ${config.trackedChannels.join(', ')}`);
  console.log(`Keywords: ${config.keywords.join(', ')}`);
  console.log(`Account boost: ${config.accountBoostMultiplier}x`);
  console.log(`Virality threshold: ${config.viralityThreshold}`);
  console.log(`Poll interval: ${config.pollIntervalMs / 1000}s`);
  console.log(`Max launches/day: ${config.maxLaunchesPerDay}`);
  console.log('');

  // Initialize database
  getDb();

  logActivity(
    'monitor_started',
    {
      trackedAccounts: config.trackedAccounts,
      trackedChannels: config.trackedChannels,
      keywords: config.keywords,
    },
    defaultSignerUuid
  );

  isRunning = true;

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    logActivity('monitor_stopped', { reason: 'SIGINT' }, defaultSignerUuid);
    isRunning = false;
    closeDb();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    logActivity('monitor_stopped', { reason: 'SIGTERM' }, defaultSignerUuid);
    isRunning = false;
    closeDb();
    process.exit(0);
  });

  // Run initial cycle
  await runCycle();

  // Schedule recurring cycles
  while (isRunning) {
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    if (isRunning) {
      await runCycle();
    }
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  logActivity('fatal_error', { error: err.message }, defaultSignerUuid);
  closeDb();
  process.exit(1);
});
