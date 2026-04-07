import { parseBody, sendJson, sendError } from '../middleware.js';

export function registerToolRoutes(router) {
  router.post('/api/tools/twitter-import', async (req, res) => {
    try {
      const { importFromTwitter } = await import('../../tools/twitter-import.js');
      const body = await parseBody(req);
      const result = await importFromTwitter(body);
      sendJson(res, result);
    } catch (err) {
      sendError(res, err.message, 500);
    }
  });
}
