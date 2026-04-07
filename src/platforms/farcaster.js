const NEYNAR_CAST_URL = 'https://api.neynar.com/v2/farcaster/cast';

async function uploadImageBase64(base64Data) {
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  try {
    const response = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': 'Client-ID c4a4a563d5dd3c3',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Clean, type: 'base64' }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Imgur upload error ${response.status}: ${errorBody}`);
    }
    const data = await response.json();
    if (data.success && data.data?.link) {
      return { success: true, url: data.data.link };
    }
    throw new Error('Upload succeeded but no URL returned');
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default {
  type: 'farcaster',

  limits: {
    maxChars: 1024,
    maxImages: 2,
    maxVideoSizeMb: 0,
    supportsGif: true,
    supportsVideo: false,
    supportsLinkPreview: true,
  },

  async validateCredentials(credentials) {
    if (!credentials.apiKey || !credentials.signerUuid) {
      return { valid: false, error: 'API key and signer UUID are required' };
    }
    try {
      const res = await fetch('https://api.neynar.com/v2/farcaster/signer', {
        headers: { 'x-api-key': credentials.apiKey, 'x-neynar-experimental': 'true' },
      });
      return { valid: res.ok, error: res.ok ? undefined : `Neynar API returned ${res.status}` };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  },

  async publish(post, credentials) {
    const { apiKey, signerUuid } = credentials;
    if (!apiKey || !signerUuid) {
      return { success: false, error: 'API key and signer UUID are required' };
    }

    const embeds = [];

    // Handle media — upload images to imgur then embed
    if (post.media && post.media.length > 0) {
      for (const item of post.media) {
        if (item.url) {
          embeds.push({ url: item.url });
        } else if (item.base64) {
          const uploaded = await uploadImageBase64(item.base64);
          if (uploaded.success) {
            embeds.push({ url: uploaded.url });
          }
        }
      }
    }

    const body = { signer_uuid: signerUuid, text: post.body };
    if (embeds.length > 0) body.embeds = embeds;

    const backoffs = [2000, 4000, 8000];
    let lastError;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(NEYNAR_CAST_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Neynar API error ${response.status}: ${errorBody}`);
        }

        const data = await response.json();
        const castHash = data.cast?.hash || data.hash;
        return {
          success: true,
          platformPostId: castHash,
          platformUrl: castHash ? `https://warpcast.com/~/conversations/${castHash}` : undefined,
        };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, backoffs[attempt]));
        }
      }
    }

    return { success: false, error: lastError?.message || 'Unknown error' };
  },

  async getProfile(credentials) {
    try {
      const res = await fetch(`https://api.neynar.com/v2/farcaster/signer?signer_uuid=${credentials.signerUuid}`, {
        headers: { 'x-api-key': credentials.apiKey },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        username: data.fid?.toString(),
        displayName: data.display_name,
        fid: data.fid,
      };
    } catch {
      return null;
    }
  },
};
