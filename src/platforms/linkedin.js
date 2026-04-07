export default {
  type: 'linkedin',

  limits: {
    maxChars: 3000,
    maxImages: 20,
    maxVideoSizeMb: 200,
    supportsGif: true,
    supportsVideo: true,
    supportsLinkPreview: true,
  },

  async validateCredentials(credentials) {
    return { valid: false, error: 'LinkedIn integration coming soon — requires OAuth setup' };
  },

  async publish(post, credentials) {
    return { success: false, error: 'LinkedIn publishing not yet implemented' };
  },

  async getProfile(credentials) {
    return null;
  },
};
