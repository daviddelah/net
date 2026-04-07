import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from './router.js';
import { sendJson, sendError } from './middleware.js';
import { createWebSocket, broadcast } from './websocket.js';
import { registerPostRoutes } from './routes/posts.js';
import { registerPlatformRoutes } from './routes/platforms.js';
import { registerQueueRoutes } from './routes/queue.js';
import { registerRecurringRoutes } from './routes/recurring.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerActivityRoutes } from './routes/activity.js';
import { registerToolRoutes } from './routes/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, '../../frontend/dist');

export function createServer(port) {
  const router = new Router();

  // Register all API routes
  registerPostRoutes(router);
  registerPlatformRoutes(router);
  registerQueueRoutes(router);
  registerRecurringRoutes(router);
  registerMediaRoutes(router);
  registerActivityRoutes(router);
  registerToolRoutes(router);

  const server = http.createServer(async (req, res) => {
    // Try API routes first
    const handled = await router.handle(req, res);
    if (handled) return;

    // Serve static files (React SPA)
    serveStatic(req, res);
  });

  createWebSocket(server);

  server.listen(port, () => {
    console.log(`Net server running at http://localhost:${port}`);
  });

  return { server, broadcast };
}

function serveStatic(req, res) {
  const pathname = req.url.split('?')[0];
  let filePath = path.join(STATIC_DIR, pathname);

  // Default to index.html for SPA routing
  if (!path.extname(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    sendError(res, 'Not found', 404);
    return;
  }

  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  res.writeHead(200, {
    'Content-Type': contentTypes[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}
