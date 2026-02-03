import { config } from '../config.js';

const TOKEN_PROFILES_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';
const TOKEN_BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/top/v1';
const PAIRS_BY_TOKEN_URL = 'https://api.dexscreener.com/latest/dex/tokens';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Trend2Token/1.0)',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

function normalizePair(pair, source = 'dexscreener') {
  const chainId = pair.chainId || '';
  const dexId = pair.dexId || 'unknown';
  const pairAddress = pair.pairAddress || pair.address || '';
  if (!pairAddress) return null;

  const baseSymbol = pair.baseToken?.symbol || pair.baseToken?.name || 'UNKNOWN';
  const baseName = pair.baseToken?.name || baseSymbol;
  const quoteSymbol = pair.quoteToken?.symbol || pair.quoteToken?.name || 'UNKNOWN';
  const priceUsd = Number(pair.priceUsd || 0);
  const liquidityUsd = Number(pair.liquidity?.usd || 0);
  const volumeH24 = Number(pair.volume?.h24 || 0);
  const volumeH1 = Number(pair.volume?.h1 || 0);
  const volumeM5 = Number(pair.volume?.m5 || 0);
  const txnsH24 = Number(pair.txns?.h24?.buys || 0) + Number(pair.txns?.h24?.sells || 0);
  const txnsM5 = Number(pair.txns?.m5?.buys || 0) + Number(pair.txns?.m5?.sells || 0);
  const fdv = Number(pair.fdv || pair.marketCap || 0);
  const createdAtRaw = Number(pair.pairCreatedAt || 0);
  const createdAtMs = createdAtRaw > 0 && createdAtRaw < 1e12 ? createdAtRaw * 1000 : createdAtRaw;
  const createdAt = createdAtMs ? new Date(createdAtMs).toISOString() : new Date().toISOString();

  const text =
    `${baseName} ($${baseSymbol}) on ${dexId} (${chainId}) | ` +
    `Price: $${priceUsd.toFixed(8)} | Vol24h: $${Math.round(volumeH24).toLocaleString()} | ` +
    `FDV: $${Math.round(fdv).toLocaleString()} | Txns24h: ${txnsH24}`;

  return {
    castHash: `dex:${chainId}:${pairAddress}`,
    text,
    authorFid: 0,
    authorHandle: `${baseSymbol}/${quoteSymbol}`,
    authorFollowers: Math.round(liquidityUsd),
    replyCount: 0,
    recastCount: Math.round(txnsH24),
    likeCount: Math.round(volumeH24),
    createdAt,
    source,
    channel: chainId || null,
    keywordMatch: null,
    // Extra fields for display
    _tokenName: baseName,
    _tokenSymbol: baseSymbol,
    _chainId: chainId,
    _dexId: dexId,
    _priceUsd: priceUsd,
    _volumeH24: volumeH24,
    _volumeH1: volumeH1,
    _fdv: fdv,
    _pairAddress: pairAddress,
    _url: pair.url || `https://dexscreener.com/${chainId}/${pairAddress}`,
  };
}

function isExcludedChain(chainId) {
  if (!chainId) return false;
  const chainLower = chainId.toLowerCase();
  return config.dexscreenerExcludedChains.some((chain) => chainLower === chain.toLowerCase());
}

function isRecent(pairCreatedAt, maxAgeMinutes) {
  if (!pairCreatedAt || !maxAgeMinutes || maxAgeMinutes <= 0) return true;
  const raw = Number(pairCreatedAt);
  const createdAtMs = raw > 0 && raw < 1e12 ? raw * 1000 : raw;
  const ageMs = Date.now() - createdAtMs;
  return ageMs <= maxAgeMinutes * 60 * 1000;
}

function getAgeMinutes(pairCreatedAt) {
  if (!pairCreatedAt) return Infinity;
  const raw = Number(pairCreatedAt);
  const createdAtMs = raw > 0 && raw < 1e12 ? raw * 1000 : raw;
  return Math.round((Date.now() - createdAtMs) / 60000);
}

export async function fetchDexscreenerPairs() {
  if (!config.dexscreenerEnabled) return [];

  const results = [];
  const seenTokens = new Set();

  try {
    // Fetch latest token profiles (newest tokens with profiles)
    const [profiles, boosts] = await Promise.all([
      fetchJson(TOKEN_PROFILES_URL).catch(() => []),
      fetchJson(TOKEN_BOOSTS_URL).catch(() => []),
    ]);

    // Combine and dedupe tokens
    const tokens = [];
    for (const p of profiles || []) {
      if (p.tokenAddress && !seenTokens.has(p.tokenAddress)) {
        seenTokens.add(p.tokenAddress);
        tokens.push({ address: p.tokenAddress, chainId: p.chainId });
      }
    }
    for (const b of boosts || []) {
      if (b.tokenAddress && !seenTokens.has(b.tokenAddress)) {
        seenTokens.add(b.tokenAddress);
        tokens.push({ address: b.tokenAddress, chainId: b.chainId });
      }
    }

    // Filter out excluded chains early
    const filteredTokens = tokens.filter((t) => !isExcludedChain(t.chainId));

    // Batch fetch pair data (API supports comma-separated addresses)
    // Process in batches of 30 to avoid URL length limits
    const batchSize = 30;
    for (let i = 0; i < filteredTokens.length && results.length < config.dexscreenerMaxPairs; i += batchSize) {
      const batch = filteredTokens.slice(i, i + batchSize);
      const addresses = batch.map((t) => t.address).join(',');

      try {
        const pairsData = await fetchJson(`${PAIRS_BY_TOKEN_URL}/${addresses}`);
        const pairs = pairsData?.pairs || [];

        for (const pair of pairs) {
          if (results.length >= config.dexscreenerMaxPairs) break;
          if (isExcludedChain(pair.chainId)) continue;

          const volumeH24 = Number(pair.volume?.h24 || 0);
          const volumeH1 = Number(pair.volume?.h1 || 0);
          const createdAt = Number(pair.pairCreatedAt || 0);

          // Check minimum volume (use h1 or h24)
          const effectiveVolume = volumeH1 > 0 ? volumeH1 : volumeH24;
          if (config.dexscreenerMinVolumeM5 > 0 && effectiveVolume < config.dexscreenerMinVolumeM5) continue;

          // Check age
          if (!isRecent(createdAt, config.dexscreenerMaxAgeMinutes)) continue;

          const normalized = normalizePair(pair);
          if (!normalized) continue;

          // Add age info
          normalized._ageMinutes = getAgeMinutes(createdAt);

          results.push(normalized);
        }

        // Small delay between batches
        if (i + batchSize < filteredTokens.length) {
          await sleep(100);
        }
      } catch (err) {
        console.error(`Error fetching pairs batch: ${err.message}`);
      }
    }

    // Sort by volume (highest first)
    results.sort((a, b) => (b._volumeH24 || 0) - (a._volumeH24 || 0));

  } catch (err) {
    console.error(`Failed to fetch Dexscreener pairs: ${err.message}`);
  }

  return results.slice(0, config.dexscreenerMaxPairs);
}
