import { useEffect, useRef, useCallback } from 'react';

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch {}
    };

    ws.onclose = () => {
      setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);
}
