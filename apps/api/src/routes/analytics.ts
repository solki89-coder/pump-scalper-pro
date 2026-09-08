import { computePnlAnalytics } from '@pump-scalper/core';
import type { FastifyInstance } from 'fastify';
import { listTrades } from '../db/repositories/trades.js';

export default async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/analytics', { preHandler: fastify.authenticate }, async (request) => {
    const trades = await listTrades(request.userId, 'ALL', 10_000);
    return computePnlAnalytics(trades);
  });
}
