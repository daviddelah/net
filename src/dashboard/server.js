import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getDb,
  getTodayStats,
  getRecentTrends,
  getTopTrends,
  getRecentLaunches,
  getHistoricalStats,
  getRecentLogs,
  logActivity,
  schedulecast,
  getScheduledCasts,
  getScheduledCast,
  getPendingScheduledCasts,
  updateScheduledCastStatus,
  updateScheduledCast,
  deleteScheduledCast,
  getScheduledCastsStats,
  getSigners,
  upsertSigner,
  updateSigner,
  deleteSigner,
  getTokenQueue,
  getQueuedToken,
  updateQueuedToken,
  deleteQueuedToken,
  insertLaunch,
  updateLaunchStatus,
  incrementDailyStat,
  registerLaunchedToken,
} from '../db/sqlite.js';
import { config } from '../config.js';
import { postCast, uploadImageBase64 } from '../deployment/farcaster.js';
import { tokenExists } from '../checks/internal.js';
import { importFromTwitter } from '../tools/twitter-import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = config.dashboardPort || 3000;

// Runtime state (for pause/resume and dynamic threshold)
const runtimeState = {
  paused: false,
  viralityThreshold: config.viralityThreshold,
  activeSignerUuid: config.neynarSignerUuids[0] || null,
};

// Initialize database
getDb();

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function uniqueSigners(base = [], extra = []) {
  const seen = new Set();
  const out = [];
  for (const value of [...base, ...extra]) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function fetchSignerInfo(signerUuid) {
  if (!config.neynarApiKey) {
    throw new Error('NEYNAR_API_KEY is required');
  }

  const url = new URL('https://api.neynar.com/v2/farcaster/signer');
  url.searchParams.set('signer_uuid', signerUuid);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'x-api-key': config.neynarApiKey,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Neynar API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data;
}
function sendHtml(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Error loading page');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // API routes
  if (url.pathname === '/api/stats') {
    // GET /api/stats - dashboard stats
    const activeSigner = runtimeState.activeSignerUuid || null;
    const stats = activeSigner
      ? getTodayStats(activeSigner)
      : { launches_count: 0, trends_detected: 0, trends_above_threshold: 0 };
    const scheduledStats = getScheduledCastsStats(activeSigner);
    const signerRows = getSigners();
    const signerUuids = uniqueSigners(
      config.neynarSignerUuids,
      signerRows.map((row) => row.signer_uuid)
    );

    if (!runtimeState.activeSignerUuid && signerUuids.length > 0) {
      runtimeState.activeSignerUuid = signerUuids[0];
    }

    sendJson(res, {
      today: {
        ...stats,
        scheduled_total: scheduledStats.total,
        scheduled_pending: scheduledStats.pending,
        scheduled_posted: scheduledStats.posted,
      },
      config: {
        trackedAccounts: config.trackedAccounts,
        trackedChannels: config.trackedChannels,
        keywords: config.keywords,
        accountBoostMultiplier: config.accountBoostMultiplier,
        viralityThreshold: runtimeState.viralityThreshold,
        pollIntervalMs: config.pollIntervalMs,
        maxLaunchesPerDay: config.maxLaunchesPerDay,
        paused: runtimeState.paused,
        signerUuids,
        activeSignerUuid: activeSigner,
        neynarClientId: config.neynarClientId,
      },
    });
  } else if (url.pathname === '/api/trends') {
    // GET /api/trends - current trending casts and scores
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const sortBy = url.searchParams.get('sort') || 'score'; // 'score' or 'recent'
    const trends = sortBy === 'score' ? getTopTrends(limit) : getRecentTrends(limit);
    sendJson(res, trends);
  } else if (url.pathname === '/api/launches') {
    // GET /api/launches - launched tokens history
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    if (!runtimeState.activeSignerUuid) {
      sendJson(res, []);
      return;
    }
    const launches = getRecentLaunches(limit, runtimeState.activeSignerUuid);
    sendJson(res, launches);
  } else if (url.pathname === '/api/logs') {
    // GET /api/logs - recent activity
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    if (!runtimeState.activeSignerUuid) {
      sendJson(res, []);
      return;
    }
    const logs = getRecentLogs(limit, runtimeState.activeSignerUuid);
    sendJson(res, logs);
  } else if (url.pathname === '/api/history') {
    // GET /api/history - historical stats
    const days = parseInt(url.searchParams.get('days') || '7', 10);
    if (!runtimeState.activeSignerUuid) {
      sendJson(res, []);
      return;
    }
    const history = getHistoricalStats(days, runtimeState.activeSignerUuid);
    sendJson(res, history);
  } else if (url.pathname === '/api/config' && req.method === 'POST') {
    // POST /api/config - update threshold, pause/resume
    try {
      const body = await parseBody(req);

      if (typeof body.viralityThreshold === 'number') {
        runtimeState.viralityThreshold = Math.max(0, Math.min(100, body.viralityThreshold));
      }
      if (typeof body.paused === 'boolean') {
        runtimeState.paused = body.paused;
      }
      if (typeof body.activeSignerUuid === 'string') {
        const trimmed = body.activeSignerUuid.trim();
        const signerRows = getSigners();
        const signerUuids = uniqueSigners(
          config.neynarSignerUuids,
          signerRows.map((row) => row.signer_uuid)
        );
        if (!signerUuids.includes(trimmed)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signer UUID' }));
          return;
        }
        runtimeState.activeSignerUuid = trimmed;
      }

      sendJson(res, {
        success: true,
        state: runtimeState,
      });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/cast' && req.method === 'POST') {
    // POST /api/cast - post a cast to Farcaster
    try {
      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      const body = await parseBody(req);
      const text = body.text?.trim();
      const imageBase64 = body.image; // base64 encoded image

      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cast text is required' }));
        return;
      }

      if (text.length > 1024) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cast text exceeds 1024 characters' }));
        return;
      }

      let imageUrl = body.imageUrl || null; // Direct URL takes priority

      // Upload image if base64 provided and no direct URL
      if (!imageUrl && imageBase64) {
        console.log('Uploading image...');
        const uploadResult = await uploadImageBase64(imageBase64, 'cast-image.png');
        if (uploadResult.success) {
          imageUrl = uploadResult.url;
          console.log(`Image uploaded: ${imageUrl}`);
        } else {
          console.error(`Image upload failed: ${uploadResult.error}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Image upload failed: ${uploadResult.error}` }));
          return;
        }
      }

      console.log(`Posting cast from dashboard: "${text.slice(0, 50)}..."`);
      const result = await postCast(text, {
        imageUrl,
        signerUuid: runtimeState.activeSignerUuid || undefined,
      });

      if (result.success) {
        logActivity(
          'manual_cast',
          { text: text.slice(0, 100), castHash: result.castHash, hasImage: !!imageUrl },
          runtimeState.activeSignerUuid
        );
        sendJson(res, {
          success: true,
          castHash: result.castHash,
          message: 'Cast posted successfully',
        });
      } else {
        logActivity(
          'manual_cast_failed',
          { text: text.slice(0, 100), error: result.error },
          runtimeState.activeSignerUuid
        );
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error || 'Failed to post cast' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/scheduled' && req.method === 'GET') {
    // GET /api/scheduled - list scheduled casts
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    if (!runtimeState.activeSignerUuid) {
      sendJson(res, []);
      return;
    }
    const scheduled = getScheduledCasts(limit, runtimeState.activeSignerUuid);
    sendJson(res, scheduled);
  } else if (url.pathname === '/api/scheduled' && req.method === 'POST') {
    // POST /api/scheduled - schedule a new cast
    try {
      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      const body = await parseBody(req);
      const text = body.text?.trim();
      const scheduledAt = body.scheduledAt;
      const imageBase64 = body.image;

      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cast text is required' }));
        return;
      }

      if (!scheduledAt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduled time is required' }));
        return;
      }

      // Validate scheduled time is in the future
      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduled time must be in the future' }));
        return;
      }

      let imageUrl = body.imageUrl || null; // Direct URL takes priority

      // Upload image if base64 provided and no direct URL
      if (!imageUrl && imageBase64) {
        const uploadResult = await uploadImageBase64(imageBase64, 'scheduled-image.png');
        if (uploadResult.success) {
          imageUrl = uploadResult.url;
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Image upload failed: ${uploadResult.error}` }));
          return;
        }
      }

      const id = schedulecast(
        text,
        scheduledDate.toISOString(),
        imageUrl,
        runtimeState.activeSignerUuid
      );
      logActivity(
        'cast_scheduled',
        { id, text: text.slice(0, 100), scheduledAt: scheduledDate.toISOString() },
        runtimeState.activeSignerUuid
      );

      sendJson(res, {
        success: true,
        id,
        message: 'Cast scheduled successfully',
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname.startsWith('/api/scheduled/') && req.method === 'DELETE') {
    // DELETE /api/scheduled/:id - delete a scheduled cast
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      if (isNaN(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid scheduled cast ID' }));
        return;
      }

      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      deleteScheduledCast(id, runtimeState.activeSignerUuid);
      logActivity('cast_unscheduled', { id }, runtimeState.activeSignerUuid);
      sendJson(res, { success: true, message: 'Scheduled cast deleted' });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname.match(/^\/api\/scheduled\/\d+$/) && req.method === 'GET') {
    // GET /api/scheduled/:id - get single scheduled cast
    const id = parseInt(url.pathname.split('/').pop(), 10);
    if (isNaN(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid scheduled cast ID' }));
      return;
    }

    if (!runtimeState.activeSignerUuid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Active signer is required' }));
      return;
    }
    const scheduled = getScheduledCast(id, runtimeState.activeSignerUuid);
    if (!scheduled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Scheduled cast not found' }));
      return;
    }

    sendJson(res, scheduled);
  } else if (url.pathname.match(/^\/api\/scheduled\/\d+$/) && req.method === 'PUT') {
    // PUT /api/scheduled/:id - update scheduled cast time/image
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      const body = await parseBody(req);

      if (isNaN(id)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid scheduled cast ID' }));
        return;
      }

      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      const scheduled = getScheduledCast(id, runtimeState.activeSignerUuid);
      if (!scheduled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduled cast not found' }));
        return;
      }

      if (scheduled.status !== 'pending') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Can only edit pending scheduled casts' }));
        return;
      }

      const scheduledAt = body.scheduledAt;
      let imageUrl =
        Object.prototype.hasOwnProperty.call(body, 'imageUrl') ? body.imageUrl : scheduled.image_url;
      const text = typeof body.text === 'string' ? body.text.trim() : scheduled.text;

      if (!scheduledAt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduled time is required' }));
        return;
      }

      const scheduledDate = new Date(scheduledAt);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Scheduled time must be in the future' }));
        return;
      }

      if (imageUrl === '') {
        imageUrl = null;
      }

      if (body.image && !imageUrl) {
        const uploadResult = await uploadImageBase64(body.image, 'scheduled-image.png');
        if (uploadResult.success) {
          imageUrl = uploadResult.url;
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Image upload failed: ${uploadResult.error}` }));
          return;
        }
      }

      updateScheduledCast(id, scheduledDate.toISOString(), imageUrl, text);
      logActivity(
        'cast_scheduled_updated',
        { id, scheduledAt: scheduledDate.toISOString() },
        runtimeState.activeSignerUuid
      );
      sendJson(res, { success: true, message: 'Scheduled cast updated' });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/signers' && req.method === 'GET') {
    // GET /api/signers - list signers
    const signers = getSigners();
    sendJson(res, signers);
  } else if (url.pathname === '/api/signers' && req.method === 'POST') {
    // POST /api/signers - add signer from SIWN
    try {
      const body = await parseBody(req);
      const signerUuid = body.signerUuid?.trim();

      if (!signerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'signerUuid is required' }));
        return;
      }

      const signerData = await fetchSignerInfo(signerUuid);
      const signer = signerData?.signer || signerData;
      const user = signer?.user || body.user || {};

      upsertSigner({
        signerUuid,
        fid: signer?.fid || user?.fid || body?.fid,
        username: user?.username || null,
        displayName: user?.display_name || user?.displayName || null,
        status: signer?.status || null,
      });

      logActivity(
        'signer_added',
        { signerUuid, fid: signer?.fid || user?.fid || body?.fid },
        signerUuid
      );
      sendJson(res, { success: true });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname.match(/^\/api\/signers\/[^/]+$/) && req.method === 'PUT') {
    // PUT /api/signers/:uuid - update signer display name
    try {
      const signerUuid = decodeURIComponent(url.pathname.split('/').pop());
      const body = await parseBody(req);

      updateSigner(signerUuid, {
        displayName: body.displayName,
        username: body.username,
      });

      logActivity('signer_updated', { signerUuid, displayName: body.displayName }, signerUuid);
      sendJson(res, { success: true, message: 'Signer updated' });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname.match(/^\/api\/signers\/[^/]+$/) && req.method === 'DELETE') {
    // DELETE /api/signers/:uuid - delete a signer
    try {
      const signerUuid = decodeURIComponent(url.pathname.split('/').pop());

      // Don't allow deleting signers from env config
      if (config.neynarSignerUuids.includes(signerUuid)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot delete signers from environment config' }));
        return;
      }

      deleteSigner(signerUuid);

      // If we deleted the active signer, switch to first available
      if (runtimeState.activeSignerUuid === signerUuid) {
        const signerRows = getSigners();
        const remaining = uniqueSigners(
          config.neynarSignerUuids,
          signerRows.map((r) => r.signer_uuid)
        );
        runtimeState.activeSignerUuid = remaining[0] || null;
      }

      logActivity('signer_deleted', { signerUuid }, runtimeState.activeSignerUuid);
      sendJson(res, { success: true, message: 'Signer deleted' });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/token-queue' && req.method === 'GET') {
    // GET /api/token-queue - list queued tokens
    const status = url.searchParams.get('status') || null;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    if (!runtimeState.activeSignerUuid) {
      sendJson(res, []);
      return;
    }
    const queue = getTokenQueue(status, limit, runtimeState.activeSignerUuid);
    sendJson(res, queue);
  } else if (url.pathname.match(/^\/api\/token-queue\/\d+$/) && req.method === 'GET') {
    // GET /api/token-queue/:id - get single queued token
    const id = parseInt(url.pathname.split('/').pop(), 10);
    if (!runtimeState.activeSignerUuid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Active signer is required' }));
      return;
    }
    const token = getQueuedToken(id, runtimeState.activeSignerUuid);
    if (!token) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Token not found' }));
      return;
    }
    sendJson(res, token);
  } else if (url.pathname.match(/^\/api\/token-queue\/\d+$/) && req.method === 'PUT') {
    // PUT /api/token-queue/:id - update queued token
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      const body = await parseBody(req);

      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      const token = getQueuedToken(id, runtimeState.activeSignerUuid);
      if (!token) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token not found' }));
        return;
      }

      if (token.status !== 'pending') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Can only edit pending tokens' }));
        return;
      }

      // Handle image upload if base64 provided
      let imageUrl = body.imageUrl;
      if (body.image && !imageUrl) {
        const uploadResult = await uploadImageBase64(body.image, 'token-image.png');
        if (uploadResult.success) {
          imageUrl = uploadResult.url;
        }
      }

      updateQueuedToken(id, {
        tokenName: body.tokenName,
        tokenTicker: body.tokenTicker,
        castText: body.castText,
        imageUrl: imageUrl,
      });

      logActivity(
        'token_queue_updated',
        { id, ticker: body.tokenTicker || token.token_ticker },
        runtimeState.activeSignerUuid
      );
      sendJson(res, { success: true, message: 'Token updated' });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname.match(/^\/api\/token-queue\/\d+\/launch$/) && req.method === 'POST') {
    // POST /api/token-queue/:id/launch - launch a queued token
    try {
      const id = parseInt(url.pathname.split('/')[3], 10);
      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      const token = getQueuedToken(id, runtimeState.activeSignerUuid);

      if (!token) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token not found' }));
        return;
      }

      if (token.status !== 'pending') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token already processed' }));
        return;
      }

      // Check for duplicates again
      if (tokenExists(token.token_name, token.token_ticker, runtimeState.activeSignerUuid || null)) {
        updateQueuedToken(id, { status: 'rejected', errorMessage: 'Duplicate token' });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token ticker or name already exists' }));
        return;
      }

      console.log(`Launching token from queue: $${token.token_ticker} - ${token.token_name}`);

      // Post the cast
      const result = await postCast(token.cast_text, {
        imageUrl: token.image_url,
        signerUuid: runtimeState.activeSignerUuid || undefined,
      });

      if (result.success) {
        // Update queue status
        updateQueuedToken(id, {
          status: 'launched',
          launchCastHash: result.castHash,
          launchedAt: new Date().toISOString(),
        });

        // Create launch record
        const launchId = insertLaunch({
          trendId: token.trend_id,
          signerUuid: token.signer_uuid || runtimeState.activeSignerUuid || null,
          tokenName: token.token_name,
          tokenTicker: token.token_ticker,
          castHash: result.castHash,
          castText: token.cast_text,
          viralityScore: token.virality_score,
          status: 'success',
        });

        // Register token and increment stats
        registerLaunchedToken(
          token.token_name,
          token.token_ticker,
          launchId,
          token.signer_uuid || runtimeState.activeSignerUuid || null
        );
        incrementDailyStat('launches_count', token.signer_uuid || runtimeState.activeSignerUuid || null);

        logActivity(
          'token_launched',
          {
            queueId: id,
            launchId,
            ticker: token.token_ticker,
            name: token.token_name,
            castHash: result.castHash,
          },
          runtimeState.activeSignerUuid
        );

        sendJson(res, {
          success: true,
          castHash: result.castHash,
          message: `Token $${token.token_ticker} launched successfully`,
        });
      } else {
        updateQueuedToken(id, { status: 'failed', errorMessage: result.error });
        logActivity(
          'token_launch_failed',
          { queueId: id, ticker: token.token_ticker, error: result.error },
          runtimeState.activeSignerUuid
        );
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error || 'Failed to launch token' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname.match(/^\/api\/token-queue\/\d+$/) && req.method === 'DELETE') {
    // DELETE /api/token-queue/:id - delete/reject a queued token
    try {
      const id = parseInt(url.pathname.split('/').pop(), 10);
      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }
      const token = getQueuedToken(id, runtimeState.activeSignerUuid);

      if (!token) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token not found' }));
        return;
      }

      if (token.status !== 'pending') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Can only delete pending tokens' }));
        return;
      }

      deleteQueuedToken(id, runtimeState.activeSignerUuid);
      logActivity('token_queue_rejected', { id, ticker: token.token_ticker }, runtimeState.activeSignerUuid);
      sendJson(res, { success: true, message: 'Token removed from queue' });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/api/import-twitter' && req.method === 'POST') {
    // POST /api/import-twitter - import tweets and schedule as casts
    try {
      if (!runtimeState.activeSignerUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Active signer is required' }));
        return;
      }

      const body = await parseBody(req);
      const username = body.username?.trim();

      if (!username) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Twitter username is required' }));
        return;
      }

      const result = await importFromTwitter({
        username,
        count: body.count || 20,
        minLikes: body.minLikes || 100,
        minRetweets: body.minRetweets || 0,
        intervalMinutes: body.intervalMinutes || 45,
        signerUuid: runtimeState.activeSignerUuid,
        dryRun: body.dryRun || false,
      });

      logActivity('twitter_import', {
        username,
        ...result,
      }, runtimeState.activeSignerUuid);

      sendJson(res, {
        success: true,
        ...result,
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    sendHtml(res, path.join(__dirname, 'index.html'));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Scheduled cast processor - runs every 30 seconds, posts max 1 cast per cycle
let lastCastTime = 0;
const MIN_CAST_INTERVAL_MS = 60000; // Minimum 1 minute between casts

async function processScheduledCasts() {
  try {
    const pendingCasts = getPendingScheduledCasts();

    // Only process one cast per cycle to avoid spam
    if (pendingCasts.length === 0) return;

    // Rate limit: wait at least MIN_CAST_INTERVAL_MS between casts
    const timeSinceLastCast = Date.now() - lastCastTime;
    if (timeSinceLastCast < MIN_CAST_INTERVAL_MS) {
      return;
    }

    // Only take the first (oldest) pending cast
    const castsToProcess = [pendingCasts[0]];

    for (const scheduled of castsToProcess) {
      if (!scheduled.signer_uuid) {
        updateScheduledCastStatus(scheduled.id, 'failed', null, 'Missing signer UUID');
        logActivity(
          'scheduled_cast_failed',
          { id: scheduled.id, error: 'Missing signer UUID' },
          null
        );
        console.error(`Scheduled cast ${scheduled.id} failed: Missing signer UUID`);
        continue;
      }
      console.log(`Processing scheduled cast ${scheduled.id}: "${scheduled.text.slice(0, 50)}..."`);

      const result = await postCast(scheduled.text, {
        imageUrl: scheduled.image_url,
        signerUuid: scheduled.signer_uuid || undefined,
      });

      if (result.success) {
        updateScheduledCastStatus(scheduled.id, 'posted', result.castHash);
        lastCastTime = Date.now(); // Update rate limit timer
        logActivity(
          'scheduled_cast_posted',
          {
            id: scheduled.id,
            text: scheduled.text.slice(0, 100),
            castHash: result.castHash,
          },
          scheduled.signer_uuid
        );
        console.log(`Scheduled cast ${scheduled.id} posted: ${result.castHash}`);
      } else {
        updateScheduledCastStatus(scheduled.id, 'failed', null, result.error);
        logActivity(
          'scheduled_cast_failed',
          {
            id: scheduled.id,
            error: result.error,
          },
          scheduled.signer_uuid
        );
        console.error(`Scheduled cast ${scheduled.id} failed: ${result.error}`);
      }
    }
  } catch (err) {
    console.error(`Error processing scheduled casts: ${err.message}`);
  }
}

// Start the scheduler
setInterval(processScheduledCasts, 30000);

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log('Scheduled cast processor started (checking every 30s)');
});
