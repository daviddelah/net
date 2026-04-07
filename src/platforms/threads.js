export default {
  type: 'threads',

  limits: {
    maxChars: 500,
    maxImages: 10,
    maxVideoSizeMb: 100,
    supportsGif: true,
    supportsVideo: true,
    supportsLinkPreview: true,
  },

  async validateCredentials(credentials) {
    return { valid: false, error: 'Threads integration coming soon — requires Meta Graph API OAuth' };
  },

  async publish(post, credentials) {
    return { success: false, error: 'Threads publishing not yet implemented' };
  },

  async getProfile(credentials) {
    return null;
  },
};
