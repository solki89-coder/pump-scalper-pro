import { scoreToken } from '@pump-scalper/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listRecentTokens } from '../db/repositories/tokens.js';

export default async function tokenRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/tokens', { preHandler: fastify.authenticate }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().positive().max(500).default(100) }).parse(request.query);
    const tokens = await listRecentTokens(query.limit);
    // Scores are computed with default weights here; the Scanner UI can
    // request per-strategy weighting separately once a strategy is selected.
    return tokens.map((token) => ({ token, scores: scoreToken(token) }));
  });
}
