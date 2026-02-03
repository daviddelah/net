import { config } from '../config.js';

const NEYNAR_CAST_URL = 'https://api.neynar.com/v2/farcaster/cast';

// Upload image to imgbb (free image hosting)
export async function uploadImageBase64(base64Data, filename = 'image.png') {
  // Remove data URL prefix if present
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');

  // Use imgbb free tier (no API key required for anonymous uploads)
  // Or use a free image hosting service
  try {
    // Try imgur anonymous upload
    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': 'Client-ID c4a4a563d5dd3c3', // Anonymous client ID
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Clean,
        type: 'base64',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Imgur upload error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    if (data.success && data.data?.link) {
      return {
        success: true,
        url: data.data.link,
      };
    } else {
      throw new Error('Upload succeeded but no URL returned');
    }
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

// Post a cast to Farcaster via Neynar API
export async function postCast(text, options = {}, retries = 3) {
  const signerUuid = options.signerUuid || config.neynarSignerUuids[0];
  if (!config.neynarApiKey || !signerUuid) {
    throw new Error('Neynar API key and signer UUID are required');
  }

  let lastError;
  const backoffs = [2000, 4000, 8000];

  // Build embeds array if image URL provided
  const embeds = [];
  if (options.imageUrl) {
    embeds.push({ url: options.imageUrl });
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const body = {
        signer_uuid: signerUuid,
        text,
      };

      if (embeds.length > 0) {
        body.embeds = embeds;
      }

      const response = await fetch(NEYNAR_CAST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.neynarApiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Neynar API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      return {
        success: true,
        castHash: data.cast?.hash || data.hash,
        cast: data.cast || data,
      };
    } catch (err) {
      lastError = err;

      if (attempt < retries - 1) {
        const backoffMs = backoffs[attempt];
        console.log(`Neynar API error, retrying in ${backoffMs / 1000}s: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Unknown error',
  };
}

// Deploy a token via Clanker on Farcaster
export async function deployToken(tokenName, ticker) {
  const castText = `@clanker deploy $${ticker} "${tokenName}"`;

  console.log(`Posting to Farcaster: ${castText}`);

  const result = await postCast(castText);

  if (result.success) {
    console.log(`Token deployment cast posted: ${result.castHash}`);
  } else {
    console.error(`Failed to post deployment cast: ${result.error}`);
  }

  return {
    ...result,
    castText,
  };
}
