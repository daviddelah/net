import { WebSocketServer } from 'ws';

let wss = null;

export function createWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('error', () => {});
  });

  return wss;
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcast(data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}
