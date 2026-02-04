import { config } from '../config.js';

const TOKEN_PROFILES_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';
const TOKEN_BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/top/v1';
const PAIRS_BY_TOKEN_URL = 'https://api.dexscreener.com/latest/dex/tokens';

// Track seen tokens to avoid duplicates
const seenTokens = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Trend2Token/1.0' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

function isPumpFunToken(tokenAddress) {
  // Pump.fun tokens end with "pump" in the address
  return tokenAddress?.toLowerCase().endsWith('pump');
}

function isRecentlyMigrated(pairCreatedAt, maxAgeMinutes = 30) {
  if (!pairCreatedAt) return false;
  const createdAtMs = pairCreatedAt > 1e12 ? pairCreatedAt : pairCreatedAt * 1000;
  const ageMinutes = (Date.now() - createdAtMs) / 60000;
  return ageMinutes <= maxAgeMinutes;
}

function normalizePumpFunToken(pair, boostInfo = null) {
  const chainId = pair.chainId || 'solana';
  const dexId = pair.dexId || 'unknown';
  const pairAddress = pair.pairAddress || '';
  if (!pairAddress) return null;

  const baseSymbol = pair.baseToken?.symbol || 'UNKNOWN';
  const baseName = pair.baseToken?.name || baseSymbol;
  const priceUsd = Number(pair.priceUsd || 0);
  const liquidityUsd = Number(pair.liquidity?.usd || 0);
  const volumeH24 = Number(pair.volume?.h24 || 0);
  const volumeH1 = Number(pair.volume?.h1 || 0);
  const fdv = Number(pair.fdv || pair.marketCap || 0);
  const createdAtRaw = Number(pair.pairCreatedAt || 0);
  const createdAtMs = createdAtRaw > 1e12 ? createdAtRaw : createdAtRaw * 1000;
  const createdAt = createdAtMs ? new Date(createdAtMs).toISOString() : new Date().toISOString();
  const ageMinutes = Math.round((Date.now() - createdAtMs) / 60000);

  const text =
    `🎓 PUMP.FUN GRADUATED: ${baseName} ($${baseSymbol}) | ` +
    `Price: $${priceUsd.toFixed(8)} | Vol24h: $${Math.round(volumeH24).toLocaleString()} | ` +
    `Liq: $${Math.round(liquidityUsd).toLocaleString()} | Age: ${ageMinutes}m`;

  return {
    castHash: `pumpfun:${chainId}:${pairAddress}`,
    text,
    authorFid: 0,
    authorHandle: `${baseSymbol}/SOL`,
    authorFollowers: Math.round(liquidityUsd),
    replyCount: 0,
    recastCount: boostInfo?.totalAmount || 0, // Use boost amount as social signal
    likeCount: Math.round(volumeH24),
    createdAt,
    source: 'pumpfun',
    channel: 'solana',
    keywordMatch: null,
    // Extra fields
    _tokenName: baseName,
    _tokenSymbol: baseSymbol,
    _tokenAddress: pair.baseToken?.address,
    _chainId: chainId,
    _dexId: dexId,
    _priceUsd: priceUsd,
    _volumeH24: volumeH24,
    _volumeH1: volumeH1,
    _liquidityUsd: liquidityUsd,
    _fdv: fdv,
    _pairAddress: pairAddress,
    _ageMinutes: ageMinutes,
    _url: pair.url || `https://dexscreener.com/${chainId}/${pairAddress}`,
    _boostAmount: boostInfo?.totalAmount || 0,
  };
}

export async function fetchPumpFunGraduated() {
  if (!config.pumpfunEnabled) return [];

  const results = [];
  const maxAge = config.pumpfunMaxAgeMinutes || 30;
  const minLiquidity = config.pumpfunMinLiquidity || 5000;
  const maxResults = config.pumpfunMaxResults || 20;

  try {
    // Fetch from both latest profiles and boosts for better coverage
    const [profiles, boosts] = await Promise.all([
      fetchJson(TOKEN_PROFILES_URL).catch(() => []),
      fetchJson(TOKEN_BOOSTS_URL).catch(() => []),
    ]);

    // Combine and dedupe pump.fun tokens
    const allTokens = [...(profiles || []), ...(boosts || [])];
    const seenAddresses = new Set();
    const pumpFunTokens = allTokens.filter((t) => {
      if (t.chainId !== 'solana' || !isPumpFunToken(t.tokenAddress)) return false;
      if (seenAddresses.has(t.tokenAddress)) return false;
      seenAddresses.add(t.tokenAddress);
      return true;
    });

    console.log(`Found ${pumpFunTokens.length} pump.fun tokens in DexScreener`);

    // Fetch pair data in batches
    const batchSize = 30;
    for (let i = 0; i < pumpFunTokens.length && results.length < maxResults; i += batchSize) {
      const batch = pumpFunTokens.slice(i, i + batchSize);
      const addresses = batch.map((t) => t.tokenAddress).join(',');

      try {
        await sleep(200); // Rate limit
        const pairsData = await fetchJson(`${PAIRS_BY_TOKEN_URL}/${addresses}`);
        const pairs = pairsData?.pairs || [];

        for (const pair of pairs) {
          if (results.length >= maxResults) break;

          // Skip if already seen
          if (seenTokens.has(pair.baseToken?.address)) continue;

          // Must be on Solana and on Raydium/PumpSwap (graduated)
          if (pair.chainId !== 'solana') continue;
          const isGraduated = ['raydium', 'pumpswap'].includes(pair.dexId?.toLowerCase());
          if (!isGraduated) continue;

          // Check if recently migrated
          if (!isRecentlyMigrated(pair.pairCreatedAt, maxAge)) continue;

          // Check minimum liquidity (more lenient for very fresh tokens)
          const liquidity = Number(pair.liquidity?.usd || 0);
          const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
          const effectiveMinLiquidity = ageMinutes < 10 ? minLiquidity / 2 : minLiquidity;
          if (liquidity < effectiveMinLiquidity) continue;

          // Find boost info for this token
          const boostInfo = pumpFunTokens.find(
            (t) => t.tokenAddress === pair.baseToken?.address
          );

          const normalized = normalizePumpFunToken(pair, boostInfo);
          if (!normalized) continue;

          // Mark as seen
          seenTokens.add(pair.baseToken?.address);
          results.push(normalized);

          console.log(
            `  Pump.fun graduated: ${normalized._tokenSymbol} | ` +
            `Liq: $${Math.round(normalized._liquidityUsd)} | ` +
            `Age: ${normalized._ageMinutes}m`
          );
        }
      } catch (err) {
        console.error(`Error fetching pump.fun pair batch: ${err.message}`);
      }
    }

    // Sort by liquidity (highest first)
    results.sort((a, b) => (b._liquidityUsd || 0) - (a._liquidityUsd || 0));

  } catch (err) {
    console.error(`Failed to fetch pump.fun graduated tokens: ${err.message}`);
  }

  return results.slice(0, maxResults);
}

// Clear seen tokens periodically (every hour)
setInterval(() => {
  seenTokens.clear();
  console.log('Cleared pump.fun seen tokens cache');
}, 60 * 60 * 1000);
