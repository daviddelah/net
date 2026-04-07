import { parseBody, sendJson, sendError } from '../middleware.js';
import {
  createQueueSlot, getQueueSlots, updateQueueSlot, deleteQueueSlot,
  getQueuedPosts, createPost, createPostTarget,
} from '../../db/sqlite.js';
import { getNextSlotTime } from '../../scheduler/queue.js';

export function registerQueueRoutes(router) {
  router.get('/api/queue/slots', async (req, res) => {
    sendJson(res, await getQueueSlots());
  });

  router.post('/api/queue/slots', async (req, res) => {
    const body = await parseBody(req);
    if (body.dayOfWeek === undefined || !body.time) {
      return sendError(res, 'dayOfWeek and time are required');
    }
    const id = await createQueueSlot(body);
    sendJson(res, { id, ...body }, 201);
  });

  router.put('/api/queue/slots/:id', async (req, res) => {
    const body = await parseBody(req);
    await updateQueueSlot(parseInt(req.params.id), body);
    sendJson(res, { success: true });
  });

  router.delete('/api/queue/slots/:id', async (req, res) => {
    await deleteQueueSlot(parseInt(req.params.id));
    sendJson(res, { success: true });
  });

  router.get('/api/queue/upcoming', async (req, res) => {
    const limit = parseInt(req.query.limit || '20');
    sendJson(res, await getQueuedPosts(limit));
  });

  router.post('/api/queue/add', async (req, res) => {
    const body = await parseBody(req);
    if (!body.body) return sendError(res, 'Post body is required');

    const postId = await createPost({
      body: body.body, media: body.media || null, status: 'queued',
    });

    if (body.platforms && Array.isArray(body.platforms)) {
      for (const platformId of body.platforms) {
        await createPostTarget({ postId, platformId });
      }
    }

    const slots = (await getQueueSlots()).filter(s => s.enabled);
    const nextSlot = getNextSlotTime(slots);

    sendJson(res, { postId, status: 'queued', estimatedPublishAt: nextSlot?.toISOString() || null }, 201);
  });
}
