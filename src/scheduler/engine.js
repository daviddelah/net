import { config } from '../config.js';
import { getAdapter } from '../platforms/index.js';
import {
  getScheduledPostsDue, getPost, getPostTargets, getPostOverrides,
  updatePost, updatePostTarget, logActivity, getPlatform,
} from '../db/sqlite.js';
import { processQueue } from './queue.js';
import { processRecurringRules } from './recurring.js';

let timer = null;
const lastPostTime = new Map(); // platformId -> timestamp

export function startScheduler(wsBroadcast = null) {
  if (timer) return;
  console.log(`Scheduler started (every ${config.schedulerIntervalMs / 1000}s)`);
  timer = setInterval(() => tick(wsBroadcast), config.schedulerIntervalMs);
  tick(wsBroadcast);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('Scheduler stopped');
  }
}

async function tick(wsBroadcast) {
  try {
    await processRecurringRules();
    await processQueue();

    const duePosts = await getScheduledPostsDue();
    for (const post of duePosts) {
      await publishPost(post, wsBroadcast);
    }
  } catch (err) {
    console.error('Scheduler tick error:', err.message);
  }
}

async function publishPost(post, wsBroadcast) {
  const targets = await getPostTargets(post.id);
  const overrides = await getPostOverrides(post.id);
  const overrideMap = new Map(overrides.map(o => [o.platform_id, o]));

  await updatePost(post.id, { status: 'posting' });

  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
    const lastTime = lastPostTime.get(target.platform_id);
    if (lastTime && Date.now() - lastTime < config.minPostIntervalMs) continue;

    const platform = await getPlatform(target.platform_id);
    if (!platform || !platform.enabled) {
      await updatePostTarget(target.id, { status: 'failed', errorMessage: 'Platform disabled or not found' });
      failCount++;
      continue;
    }

    const adapter = getAdapter(platform.type);
    const override = overrideMap.get(target.platform_id);

    const publishData = {
      body: override?.body || post.body,
      media: override?.media || post.media || [],
    };

    if (publishData.body.length > adapter.limits.maxChars) {
      publishData.body = publishData.body.slice(0, adapter.limits.maxChars - 3) + '...';
    }

    await updatePostTarget(target.id, { status: 'posting' });

    try {
      const result = await adapter.publish(publishData, platform.credentials);
      const now = new Date().toISOString();

      if (result.success) {
        await updatePostTarget(target.id, {
          status: 'posted', platformPostId: result.platformPostId,
          platformUrl: result.platformUrl, postedAt: now,
        });
        lastPostTime.set(target.platform_id, Date.now());
        successCount++;
        await logActivity('post_published', {
          postId: post.id, platformType: platform.type,
          platformName: platform.name, platformPostId: result.platformPostId,
        }, target.platform_id);
      } else {
        await updatePostTarget(target.id, { status: 'failed', errorMessage: result.error });
        failCount++;
        await logActivity('post_failed', {
          postId: post.id, platformType: platform.type, error: result.error,
        }, target.platform_id);
      }
    } catch (err) {
      await updatePostTarget(target.id, { status: 'failed', errorMessage: err.message });
      failCount++;
    }
  }

  const now = new Date().toISOString();
  if (successCount > 0 && failCount === 0) {
    await updatePost(post.id, { status: 'posted', postedAt: now });
  } else if (successCount > 0 && failCount > 0) {
    await updatePost(post.id, { status: 'partial', postedAt: now });
  } else if (failCount > 0) {
    await updatePost(post.id, { status: 'failed' });
  }

  if (wsBroadcast) {
    const updated = await getPost(post.id);
    wsBroadcast({ type: 'post_update', post: updated });
  }
}
