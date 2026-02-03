// Stop words to filter out
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
  'shall', 'can', 'need', 'dare', 'ought', 'used', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom',
  'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
  'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
  'http', 'https', 'www', 'com', 'org', 'net', 'io', 'co', 'farcaster', 'warpcast',
  'reply', 'recast', 'like', 'follow', 'cast', 'casts',
]);

// Token name templates
const TEMPLATES = [
  '{word} Coin',
  '{word} Token',
  '{word}DAO',
  'Baby {word}',
  '{word} Inu',
  '{word} Moon',
  'Super {word}',
  '{word} Protocol',
  '{word} Finance',
  'Mega {word}',
];

// Capitalize first letter
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Extract notable keywords from text
function extractKeywords(text) {
  // Remove URLs
  const cleaned = text.replace(/https?:\/\/\S+/g, '');

  // Extract existing tickers (e.g., $DEGEN)
  const tickerMatches = cleaned.match(/\$([A-Z]{3,6})/g) || [];
  const existingTickers = tickerMatches.map((t) => t.slice(1));

  // Extract hashtags
  const hashtagMatches = cleaned.match(/#(\w{3,15})/g) || [];
  const hashtags = hashtagMatches.map((h) => h.slice(1).toLowerCase());

  // Extract ALL CAPS words (likely important)
  const capsMatches = cleaned.match(/\b([A-Z]{3,10})\b/g) || [];
  const capsWords = capsMatches
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());

  // Extract regular words
  const words = cleaned
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 12)
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .map((w) => w.toLowerCase());

  // Score and rank words
  const wordScores = new Map();

  // Existing tickers get highest score
  existingTickers.forEach((w) => {
    wordScores.set(w.toLowerCase(), (wordScores.get(w.toLowerCase()) || 0) + 10);
  });

  // Hashtags get high score
  hashtags.forEach((w) => {
    wordScores.set(w, (wordScores.get(w) || 0) + 5);
  });

  // ALL CAPS words get medium score
  capsWords.forEach((w) => {
    wordScores.set(w, (wordScores.get(w) || 0) + 3);
  });

  // Regular words get base score, boosted by position (earlier = higher)
  words.forEach((w, i) => {
    const positionBonus = Math.max(0, 2 - i * 0.1);
    wordScores.set(w, (wordScores.get(w) || 0) + 1 + positionBonus);
  });

  // Sort by score and return top keywords
  return Array.from(wordScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

// Generate ticker from word(s)
function generateTicker(words) {
  if (words.length === 0) {
    return 'TRND';
  }

  const primaryWord = words[0].toUpperCase();

  // If single word is 3-5 chars, use it directly
  if (primaryWord.length >= 3 && primaryWord.length <= 5) {
    return primaryWord;
  }

  // If single word is longer, take first 4-5 chars
  if (words.length === 1) {
    return primaryWord.slice(0, Math.min(5, Math.max(3, primaryWord.length)));
  }

  // Take first letter of each word
  const acronym = words
    .slice(0, 4)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (acronym.length >= 3) {
    return acronym.slice(0, 5);
  }

  // Fallback to first word truncated
  return primaryWord.slice(0, 4);
}

// Main generation function
export function generateTokenName(trendText, authorHandle) {
  const keywords = extractKeywords(trendText);

  if (keywords.length === 0) {
    return generateFallbackName(trendText);
  }

  const primaryWord = keywords[0];

  // Select a random template
  const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const name = template.replace('{word}', capitalize(primaryWord));

  // Generate ticker from top keywords
  const ticker = generateTicker(keywords.slice(0, 2));

  return { name, ticker };
}

// Generate a fallback name without complex extraction
export function generateFallbackName(trendText) {
  // Extract notable words from the trend
  const words = trendText
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 2);

  const name = words.length > 0 ? `${words.map(capitalize).join(' ')} Coin` : 'Trend Coin';
  const ticker = words.length > 0
    ? words.map((w) => w[0]).join('').toUpperCase().slice(0, 4)
    : 'TRND';

  return { name, ticker: ticker || 'TRND' };
}
