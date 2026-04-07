import { parseBody, sendJson, sendError } from '../middleware.js';
import {
  createPlatform, getPlatforms, getPlatform, updatePlatform, deletePlatform,
  logActivity,
} from '../../db/sqlite.js';
import { getAdapter, getSupportedTypes } from '../../platforms/index.js';

export function registerPlatformRoutes(router) {
  router.get('/api/platforms', async (req, res) => {
    const platforms = await getPlatforms();
    const safe = platforms.map(p => ({ ...p, credentials: { configured: true } }));
    sendJson(res, safe);
  });

  router.get('/api/platforms/types', (req, res) => {
    const types = getSupportedTypes();
    const adapters = types.map(type => {
      const adapter = getAdapter(type);
      return { type, limits: adapter.limits };
    });
    sendJson(res, adapters);
  });

  router.post('/api/platforms', async (req, res) => {
    const body = await parseBody(req);
    if (!body.type || !body.name || !body.credentials) {
      return sendError(res, 'type, name, and credentials are required');
    }

    try { getAdapter(body.type); } catch {
      return sendError(res, `Unsupported platform type: ${body.type}`);
    }

    const existing = (await getPlatforms()).filter(p => p.type === body.type);
    const id = `${body.type}-${existing.length + 1}`;

    await createPlatform({
      id, type: body.type, name: body.name,
      credentials: body.credentials, metadata: body.metadata || null,
    });

    await logActivity('platform_added', { id, type: body.type, name: body.name });
    sendJson(res, { id, type: body.type, name: body.name }, 201);
  });

  router.put('/api/platforms/:id', async (req, res) => {
    const platform = await getPlatform(req.params.id);
    if (!platform) return sendError(res, 'Platform not found', 404);

    const body = await parseBody(req);
    await updatePlatform(req.params.id, body);
    sendJson(res, { success: true });
  });

  router.delete('/api/platforms/:id', async (req, res) => {
    const platform = await getPlatform(req.params.id);
    if (!platform) return sendError(res, 'Platform not found', 404);

    await deletePlatform(req.params.id);
    await logActivity('platform_removed', { id: req.params.id });
    sendJson(res, { success: true });
  });

  router.post('/api/platforms/:id/test', async (req, res) => {
    const platform = await getPlatform(req.params.id);
    if (!platform) return sendError(res, 'Platform not found', 404);

    const adapter = getAdapter(platform.type);
    const result = await adapter.validateCredentials(platform.credentials);
    sendJson(res, result);
  });
}
