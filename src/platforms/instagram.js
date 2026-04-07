export default {
  type: 'instagram',

  limits: {
    maxChars: 2200,
    maxImages: 10,
    maxVideoSizeMb: 650,
    supportsGif: false,
    supportsVideo: true,
    supportsLinkPreview: false,
  },

  async validateCredentials(credentials) {
    return { valid: false, error: 'Instagram integration coming soon — requires Meta Graph API OAuth' };
  },

  async publish(post, credentials) {
    return { success: false, error: 'Instagram publishing not yet implemented' };
  },

  async getProfile(credentials) {
    return null;
  },
};
