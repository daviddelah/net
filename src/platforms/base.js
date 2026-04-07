/**
 * Platform adapter interface.
 * Each platform module must export an object matching this shape.
 */
export const PlatformInterface = {
  type: '',          // 'farcaster' | 'twitter' | 'linkedin' | 'threads' | 'instagram'

  limits: {
    maxChars: 0,
    maxImages: 0,
    maxVideoSizeMb: 0,
    supportsGif: false,
    supportsVideo: false,
    supportsLinkPreview: false,
  },

  /**
   * @param {object} credentials
   * @returns {Promise<{ valid: boolean, error?: string, profile?: object }>}
   */
  async validateCredentials(credentials) { throw new Error('Not implemented'); },

  /**
   * @param {{ body: string, media?: object[] }} post
   * @param {object} credentials
   * @returns {Promise<{ success: boolean, platformPostId?: string, platformUrl?: string, error?: string }>}
   */
  async publish(post, credentials) { throw new Error('Not implemented'); },

  /**
   * @param {object} credentials
   * @returns {Promise<{ username?: string, displayName?: string, avatar?: string }>}
   */
  async getProfile(credentials) { return null; },
};
