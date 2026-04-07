import { parseMultipart, sendJson, sendError } from '../middleware.js';
import { saveFile, deleteFile } from '../../media/storage.js';
import { validateMedia } from '../../media/validator.js';

export function registerMediaRoutes(router) {
  router.post('/api/media/upload', async (req, res) => {
    try {
      const { files } = await parseMultipart(req);
      if (!files || files.length === 0) return sendError(res, 'No file uploaded');

      const results = [];
      for (const file of files) {
        const validation = validateMedia({ mimeType: file.mimeType, sizeBytes: file.buffer.length });
        if (!validation.valid) {
          results.push({ filename: file.filename, errors: validation.errors });
          continue;
        }
        const media = await saveFile(file);
        results.push({ id: media.id, filename: media.filename, mimeType: media.mimeType, sizeBytes: media.sizeBytes });
      }
      sendJson(res, results, 201);
    } catch (err) {
      sendError(res, err.message, 500);
    }
  });

  router.delete('/api/media/:id', async (req, res) => {
    await deleteFile(req.params.id);
    sendJson(res, { success: true });
  });
}
