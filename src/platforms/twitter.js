import { execSync } from 'child_process';
import fs from 'fs';

async function downloadImage(imageUrl) {
  if (!imageUrl) return null;
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
    const tempPath = `/tmp/net-tweet-${Date.now()}.${ext}`;
    fs.writeFileSync(tempPath, Buffer.from(buffer));
    return tempPath;
  } catch {
    return null;
  }
}

export default {
  type: 'twitter',

  limits: {
    maxChars: 280,
    maxImages: 4,
    maxVideoSizeMb: 512,
    supportsGif: true,
    supportsVideo: true,
    supportsLinkPreview: true,
  },

  async validateCredentials(credentials) {
    if (!credentials.authToken || !credentials.ct0) {
      return { valid: false, error: 'AUTH_TOKEN and CT0 cookies are required' };
    }
    try {
      execSync('npx bird check', {
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, AUTH_TOKEN: credentials.authToken, CT0: credentials.ct0 },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.stderr || err.message };
    }
  },

  async publish(post, credentials) {
    const { authToken, ct0 } = credentials;
    if (!authToken || !ct0) {
      return { success: false, error: 'Twitter credentials not configured' };
    }

    try {
      let text = post.body;
      if (text.length > 280) text = text.slice(0, 277) + '...';

      let cmd = `npx bird tweet "${text.replace(/"/g, '\\"')}"`;

      // Handle first image if present
      if (post.media && post.media.length > 0) {
        const first = post.media[0];
        let imagePath = first.path;
        if (!imagePath && first.url) {
          imagePath = await downloadImage(first.url);
        }
        if (imagePath) {
          cmd += ` --media "${imagePath}"`;
        }
      }

      const result = execSync(cmd, {
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 60000,
        env: { ...process.env, AUTH_TOKEN: authToken, CT0: ct0 },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const urlMatch = result.match(/https:\/\/x\.com\/\w+\/status\/(\d+)/);
      return {
        success: true,
        platformPostId: urlMatch?.[1] || null,
        platformUrl: urlMatch?.[0] || null,
      };
    } catch (err) {
      return { success: false, error: err.stderr || err.message };
    }
  },

  async getProfile(credentials) {
    try {
      const result = execSync('npx bird whoami --json', {
        encoding: 'utf8',
        timeout: 15000,
        env: { ...process.env, AUTH_TOKEN: credentials.authToken, CT0: credentials.ct0 },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(result);
      return {
        username: data.username || data.screen_name,
        displayName: data.name,
        avatar: data.profile_image_url_https,
      };
    } catch {
      return null;
    }
  },
};
