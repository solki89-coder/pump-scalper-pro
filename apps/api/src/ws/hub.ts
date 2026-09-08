import { WsMessageSchema, type WsMessage } from '@pump-scalper/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

const clients = new Set<WebSocket>();

/**
 * Every real-time channel the spec calls for (token feed, price updates,
 * positions, PnL, bot status, trade events) goes through this single
 * broadcaster and the shared `WsMessage` envelope (packages/shared/src/ws.ts)
 * — one connection, one schema, no per-feature polling loops on the client.
 * Validated before sending so a bug elsewhere can't push malformed data to
 * every connected dashboard.
 */
export function broadcast(message: WsMessage): void {
  const validated = WsMessageSchema.parse(message);
  const payload = JSON.stringify(validated);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

export function connectedClientCount(): number {
  return clients.size;
}

export default async function registerWsHub(fastify: FastifyInstance): Promise<void> {
  fastify.get('/ws', { websocket: true, preHandler: fastify.authenticate }, (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
}
