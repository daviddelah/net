import CronParser from 'cron-parser';
import {
  getRecurringRulesDue, updateRecurringRule,
  getPost, createPost, getPostTargets, createPostTarget,
  getPostOverrides, setPostOverride,
} from '../db/sqlite.js';

export async function processRecurringRules() {
  const dueRules = await getRecurringRulesDue();

  for (const rule of dueRules) {
    try {
      const template = await getPost(rule.post_id);
      if (!template) {
        await updateRecurringRule(rule.id, { enabled: false });
        continue;
      }

      const newPostId = await createPost({
        body: template.body,
        media: template.media,
        status: 'scheduled',
        scheduledAt: rule.next_run_at,
        recurringRuleId: rule.id,
      });

      const targets = await getPostTargets(rule.post_id);
      for (const t of targets) {
        await createPostTarget({ postId: newPostId, platformId: t.platform_id });
      }

      const overrides = await getPostOverrides(rule.post_id);
      for (const o of overrides) {
        await setPostOverride(newPostId, o.platform_id, { body: o.body, media: o.media });
      }

      const nextRunAt = computeNextRun(rule.cron_expression, rule.timezone);
      const runsCompleted = (rule.runs_completed || 0) + 1;

      if (rule.repeat_count > 0 && runsCompleted >= rule.repeat_count) {
        await updateRecurringRule(rule.id, {
          enabled: false, lastRunAt: new Date().toISOString(),
          runsCompleted, nextRunAt: null,
        });
      } else {
        await updateRecurringRule(rule.id, {
          lastRunAt: new Date().toISOString(), runsCompleted,
          nextRunAt: nextRunAt?.toISOString() || null,
        });
      }
    } catch (err) {
      console.error(`Recurring rule ${rule.id} error:`, err.message);
    }
  }
}

export function computeNextRun(cronExpression, timezone = 'UTC') {
  try {
    const interval = CronParser.parseExpression(cronExpression, {
      currentDate: new Date(), tz: timezone,
    });
    return interval.next().toDate();
  } catch (err) {
    console.error(`Invalid cron expression "${cronExpression}":`, err.message);
    return null;
  }
}
