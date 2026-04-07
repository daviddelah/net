import { parseBody, sendJson, sendError } from '../middleware.js';
import {
  createRecurringRule, getRecurringRules, updateRecurringRule, deleteRecurringRule,
  getPost,
} from '../../db/sqlite.js';
import { computeNextRun } from '../../scheduler/recurring.js';

export function registerRecurringRoutes(router) {
  router.get('/api/recurring', async (req, res) => {
    const rules = await getRecurringRules();
    const result = [];
    for (const rule of rules) {
      const post = await getPost(rule.post_id);
      result.push({ ...rule, templatePost: post });
    }
    sendJson(res, result);
  });

  router.post('/api/recurring', async (req, res) => {
    const body = await parseBody(req);
    if (!body.postId || !body.cronExpression) {
      return sendError(res, 'postId and cronExpression are required');
    }

    const post = await getPost(body.postId);
    if (!post) return sendError(res, 'Template post not found', 404);

    const nextRunAt = computeNextRun(body.cronExpression, body.timezone);
    if (!nextRunAt) return sendError(res, 'Invalid cron expression');

    const id = await createRecurringRule({
      postId: body.postId, cronExpression: body.cronExpression,
      timezone: body.timezone || 'UTC', nextRunAt: nextRunAt.toISOString(),
      repeatCount: body.repeatCount || 0,
    });

    sendJson(res, { id, nextRunAt: nextRunAt.toISOString() }, 201);
  });

  router.put('/api/recurring/:id', async (req, res) => {
    const body = await parseBody(req);
    const id = parseInt(req.params.id);

    if (body.cronExpression) {
      const nextRunAt = computeNextRun(body.cronExpression, body.timezone);
      if (!nextRunAt) return sendError(res, 'Invalid cron expression');
      body.nextRunAt = nextRunAt.toISOString();
    }

    await updateRecurringRule(id, body);
    sendJson(res, { success: true });
  });

  router.delete('/api/recurring/:id', async (req, res) => {
    await deleteRecurringRule(parseInt(req.params.id));
    sendJson(res, { success: true });
  });
}
