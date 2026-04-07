import { parseBody, sendJson, sendError } from '../middleware.js';
import {
  createPost, getPost, getPosts, updatePost, deletePost,
  createPostTarget, getPostTargets, getPostOverrides, setPostOverride,
  logActivity, getDb,
} from '../../db/sqlite.js';

export function registerPostRoutes(router) {
  router.get('/api/posts', async (req, res) => {
    const { status, limit = '50', offset = '0' } = req.query;
    const posts = await getPosts({ status, limit: parseInt(limit), offset: parseInt(offset) });

    const result = [];
    for (const p of posts) {
      result.push({
        ...p,
        targets: await getPostTargets(p.id),
        overrides: await getPostOverrides(p.id),
      });
    }
    sendJson(res, result);
  });

  router.get('/api/posts/:id', async (req, res) => {
    const post = await getPost(parseInt(req.params.id));
    if (!post) return sendError(res, 'Post not found', 404);
    sendJson(res, {
      ...post,
      targets: await getPostTargets(post.id),
      overrides: await getPostOverrides(post.id),
    });
  });

  router.post('/api/posts', async (req, res) => {
    const body = await parseBody(req);
    if (!body.body) return sendError(res, 'Post body is required');

    const postId = await createPost({
      body: body.body,
      media: body.media || null,
      status: body.scheduledAt ? 'scheduled' : (body.queued ? 'queued' : 'draft'),
      scheduledAt: body.scheduledAt || null,
    });

    if (body.platforms && Array.isArray(body.platforms)) {
      for (const platformId of body.platforms) {
        await createPostTarget({ postId, platformId });
      }
    }

    if (body.overrides && typeof body.overrides === 'object') {
      for (const [platformId, override] of Object.entries(body.overrides)) {
        await setPostOverride(postId, platformId, override);
      }
    }

    await logActivity('post_created', { postId, status: body.scheduledAt ? 'scheduled' : 'draft' });

    const post = await getPost(postId);
    sendJson(res, {
      ...post,
      targets: await getPostTargets(postId),
      overrides: await getPostOverrides(postId),
    }, 201);
  });

  router.put('/api/posts/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const post = await getPost(id);
    if (!post) return sendError(res, 'Post not found', 404);

    const body = await parseBody(req);
    const updates = {};
    if (body.body !== undefined) updates.body = body.body;
    if (body.media !== undefined) updates.media = body.media;
    if (body.scheduledAt !== undefined) {
      updates.scheduledAt = body.scheduledAt;
      updates.status = body.scheduledAt ? 'scheduled' : 'draft';
    }
    if (body.status !== undefined) updates.status = body.status;

    await updatePost(id, updates);

    if (body.platforms && Array.isArray(body.platforms)) {
      const d = await getDb();
      await d.execute({ sql: 'DELETE FROM post_targets WHERE post_id = ?', args: [id] });
      for (const platformId of body.platforms) {
        await createPostTarget({ postId: id, platformId });
      }
    }

    if (body.overrides && typeof body.overrides === 'object') {
      for (const [platformId, override] of Object.entries(body.overrides)) {
        await setPostOverride(id, platformId, override);
      }
    }

    const updated = await getPost(id);
    sendJson(res, {
      ...updated,
      targets: await getPostTargets(id),
      overrides: await getPostOverrides(id),
    });
  });

  router.delete('/api/posts/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const post = await getPost(id);
    if (!post) return sendError(res, 'Post not found', 404);
    if (post.status === 'posting') return sendError(res, 'Cannot delete a post that is currently being published');

    await deletePost(id);
    await logActivity('post_deleted', { postId: id });
    sendJson(res, { success: true });
  });

  router.post('/api/posts/:id/publish', async (req, res) => {
    const id = parseInt(req.params.id);
    const post = await getPost(id);
    if (!post) return sendError(res, 'Post not found', 404);

    await updatePost(id, { status: 'scheduled', scheduledAt: new Date().toISOString() });
    await logActivity('post_publish_requested', { postId: id });
    sendJson(res, { success: true, message: 'Post queued for immediate publishing' });
  });

  router.post('/api/posts/:id/reschedule', async (req, res) => {
    const id = parseInt(req.params.id);
    const post = await getPost(id);
    if (!post) return sendError(res, 'Post not found', 404);

    const body = await parseBody(req);
    if (!body.scheduledAt) return sendError(res, 'scheduledAt is required');

    await updatePost(id, { status: 'scheduled', scheduledAt: body.scheduledAt });
    sendJson(res, { success: true });
  });
}
