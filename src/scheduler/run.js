#!/usr/bin/env node
/**
 * Standalone scheduler runner for GitHub Actions.
 * Connects to Turso, processes due posts, then exits.
 *
 * Required env vars:
 *   TURSO_DATABASE_URL - Turso database URL
 *   TURSO_AUTH_TOKEN   - Turso auth token
 *   NEYNAR_API_KEY     - Neynar API key (for Farcaster)
 *   FARCASTER_SIGNER_UUIDS - Signer UUIDs
 *   AUTH_TOKEN / CT0   - Twitter cookies (for Twitter)
 */

import 'dotenv/config';
import { getDb, closeDb, getScheduledPostsDue, getPostTargets, getPostOverrides, updatePost, updatePostTarget, logActivity, getPlatform } from '../db/sqlite.js';
import { processRecurringRules } from './recurring.js';
import { processQueue } from './queue.js';
import { getAdapter } from '../platforms/index.js';

async function run() {
  console.log(`[${new Date().toISOString()}] Scheduler run starting...`);

  await getDb();

  // 1. Process recurring rules
  await processRecurringRules();

  // 2. Process queue
  await processQueue();

  // 3. Publish due posts
  const duePosts = await getScheduledPostsDue();
  console.log(`Found ${duePosts.length} post(s) due for publishing`);

  for (const post of duePosts) {
    await publishPost(post);
  }

  await closeDb();
  console.log(`[${new Date().toISOString()}] Scheduler run complete`);
}

async function publishPost(post) {
  const targets = await getPostTargets(post.id);
  const overrides = await getPostOverrides(post.id);
  const overrideMap = new Map(overrides.map(o => [o.platform_id, o]));

  await updatePost(post.id, { status: 'posting' });

  let successCount = 0;
  let failCount = 0;

  for (const target of targets) {
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
        successCount++;
        console.log(`  Published post #${post.id} to ${platform.name}: ${result.platformUrl || result.platformPostId}`);
        await logActivity('post_published', {
          postId: post.id, platformType: platform.type,
          platformName: platform.name, platformPostId: result.platformPostId,
        }, target.platform_id);
      } else {
        await updatePostTarget(target.id, { status: 'failed', errorMessage: result.error });
        failCount++;
        console.error(`  Failed post #${post.id} to ${platform.name}: ${result.error}`);
        await logActivity('post_failed', {
          postId: post.id, platformType: platform.type, error: result.error,
        }, target.platform_id);
      }
    } catch (err) {
      await updatePostTarget(target.id, { status: 'failed', errorMessage: err.message });
      failCount++;
      console.error(`  Error post #${post.id}: ${err.message}`);
    }
  }

  const now = new Date().toISOString();
  if (successCount > 0 && failCount === 0) {
    await updatePost(post.id, { status: 'posted', postedAt: now });
  } else if (successCount > 0) {
    await updatePost(post.id, { status: 'partial', postedAt: now });
  } else if (failCount > 0) {
    await updatePost(post.id, { status: 'failed' });
  }
}

run().catch(err => {
  console.error('Scheduler run failed:', err);
  process.exit(1);
});
