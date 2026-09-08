import { TradeHistoryFilterSchema } from '@pump-scalper/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listTrades } from '../db/repositories/trades.js';

const FilterMap = { TODAY: 'TODAY', SEVEN_DAYS: 'SEVEN_DAYS', THIRTY_DAYS: 'THIRTY_DAYS', ALL: 'ALL' } as const;

export default async function tradeRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/trades', { preHandler: fastify.authenticate }, async (request) => {
    const query = z.object({ filter: TradeHistoryFilterSchema.default('ALL') }).parse(request.query);
    return listTrades(request.userId, FilterMap[query.filter]);
  });
}
