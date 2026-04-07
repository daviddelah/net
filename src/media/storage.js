import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';
import { insertMedia, deleteMedia as dbDeleteMedia, getMedia } from '../db/sqlite.js';

export function ensureUploadsDir() {
  if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
  }
}

export async function saveFile(file) {
  ensureUploadsDir();

  const id = crypto.randomUUID();
  const ext = path.extname(file.filename) || mimeToExt(file.mimeType);
  const diskFilename = `${id}${ext}`;
  const filePath = path.join(config.uploadsDir, diskFilename);

  fs.writeFileSync(filePath, file.buffer);

  const media = {
    id, filename: file.filename, mimeType: file.mimeType,
    sizeBytes: file.buffer.length, path: filePath,
  };

  await insertMedia(media);
  return media;
}

export async function deleteFile(id) {
  const media = await getMedia(id);
  if (media && media.path && fs.existsSync(media.path)) {
    fs.unlinkSync(media.path);
  }
  await dbDeleteMedia(id);
}

function mimeToExt(mimeType) {
  const map = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
    'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov',
    'video/webm': '.webm',
  };
  return map[mimeType] || '';
}
