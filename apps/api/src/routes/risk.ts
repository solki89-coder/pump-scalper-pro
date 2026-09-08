import { RiskConfigSchema } from '@pump-scalper/shared';
import type { FastifyInstance } from 'fastify';
import { getRiskConfig, upsertRiskConfig } from '../db/repositories/riskConfig.js';
import { createSystemEvent } from '../db/repositories/systemEvents.js';

const RiskConfigInputSchema = RiskConfigSchema.omit({ userId: true });

export default async function riskRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/risk-config', { preHandler: fastify.authenticate }, async (request, reply) => {
    const config = await getRiskConfig(request.userId);
    if (!config) return reply.code(404).send({ error: 'No risk configuration set yet' });
    return config;
  });

  fastify.put('/api/risk-config', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = RiskConfigInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid risk configuration', details: parsed.error.issues });
    const saved = await upsertRiskConfig({ ...parsed.data, userId: request.userId });
    await createSystemEvent({ userId: request.userId, type: 'RISK_CONFIG_UPDATED', details: {} });
    return saved;
  });
}
