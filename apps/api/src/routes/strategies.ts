import { StrategyConfigInputSchema } from '@pump-scalper/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createStrategy,
  deleteStrategy,
  getStrategy,
  listStrategies,
  updateStrategy,
} from '../db/repositories/strategies.js';

export default async function strategyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/strategies', { preHandler: fastify.authenticate }, async (request) => {
    return listStrategies(request.userId);
  });

  fastify.post('/api/strategies', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = StrategyConfigInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid strategy', details: parsed.error.issues });
    const created = await createStrategy({ ...parsed.data, userId: request.userId });
    return reply.code(201).send(created);
  });

  fastify.put('/api/strategies/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await getStrategy(params.id);
    if (!existing || existing.userId !== request.userId) return reply.code(404).send({ error: 'Strategy not found' });

    const parsed = StrategyConfigInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid strategy', details: parsed.error.issues });

    const updated = await updateStrategy(params.id, { ...parsed.data, id: params.id, userId: request.userId });
    return updated;
  });

  fastify.delete('/api/strategies/:id', { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await getStrategy(params.id);
    if (!existing || existing.userId !== request.userId) return reply.code(404).send({ error: 'Strategy not found' });
    await deleteStrategy(params.id);
    return reply.code(204).send();
  });
}
