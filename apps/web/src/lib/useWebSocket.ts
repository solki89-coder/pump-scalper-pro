'use client';

import type { WsMessage } from '@pump-scalper/shared';
import { useEffect, useRef } from 'react';
import { wsUrl } from './api';

/**
 * One shared channel for every live feed the dashboard needs (token,
 * score, signal, position, trade, bot status, portfolio) — the
 * WsMessage['channel'] discriminant tells the caller which one arrived,
 * matching the single-connection design in packages/shared/src/ws.ts and
 * apps/api/src/ws/hub.ts. Reconnects automatically on drop.
 */
export function useWsSubscription(onMessage: (msg: WsMessage) => void): void {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(wsUrl());
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WsMessage;
          handlerRef.current(msg);
        } catch {
          // Ignore a malformed frame rather than tearing down the connection.
        }
      };
      socket.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 3000);
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);
}
