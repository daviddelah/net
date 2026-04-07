import { sendJson } from '../middleware.js';
import { getRecentLogs, getPostStats } from '../../db/sqlite.js';

export function registerActivityRoutes(router) {
  router.get('/api/activity', async (req, res) => {
    const limit = parseInt(req.query.limit || '50');
    sendJson(res, await getRecentLogs(limit));
  });

  router.get('/api/stats', async (req, res) => {
    sendJson(res, await getPostStats());
  });
}
