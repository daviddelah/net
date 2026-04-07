const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB

/**
 * Validate a media file before saving.
 * @param {{ mimeType: string, sizeBytes: number }} file
 * @param {object} platformLimits - optional platform-specific limits
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMedia(file, platformLimits = null) {
  const errors = [];

  const isImage = ALLOWED_IMAGE_TYPES.includes(file.mimeType);
  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.mimeType);

  if (!isImage && !isVideo) {
    errors.push(`Unsupported file type: ${file.mimeType}`);
    return { valid: false, errors };
  }

  if (isImage && file.sizeBytes > MAX_IMAGE_SIZE) {
    errors.push(`Image too large: ${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`);
  }

  if (isVideo && file.sizeBytes > MAX_VIDEO_SIZE) {
    errors.push(`Video too large: ${(file.sizeBytes / 1024 / 1024).toFixed(1)}MB (max ${MAX_VIDEO_SIZE / 1024 / 1024}MB)`);
  }

  if (platformLimits) {
    if (isVideo && !platformLimits.supportsVideo) {
      errors.push('This platform does not support video');
    }
    if (file.mimeType === 'image/gif' && !platformLimits.supportsGif) {
      errors.push('This platform does not support GIFs');
    }
    if (isVideo && platformLimits.maxVideoSizeMb) {
      const maxBytes = platformLimits.maxVideoSizeMb * 1024 * 1024;
      if (file.sizeBytes > maxBytes) {
        errors.push(`Video exceeds platform limit: ${platformLimits.maxVideoSizeMb}MB`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
