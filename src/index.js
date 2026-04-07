import { config } from './config.js';
import { getDb, closeDb } from './db/sqlite.js';
import { createServer } from './server/index.js';
import { startScheduler, stopScheduler } from './scheduler/engine.js';
import { broadcast } from './server/websocket.js';
import { ensureUploadsDir } from './media/storage.js';

// Initialize
console.log('Starting Net...');
await getDb(); // init DB + schema
ensureUploadsDir();

// Start server
const { server } = createServer(config.port);

// Start scheduler with WebSocket broadcast
startScheduler(broadcast);

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  stopScheduler();
  server.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
