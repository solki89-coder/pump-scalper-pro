import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.js';
import { getOrCreateBotState, updateBotState } from '../db/repositories/botState.js';
import { createSystemEvent } from '../db/repositories/systemEvents.js';
import { activateKillSwitch, deactivateKillSwitch } from '../risk/killSwitch.js';

export default async function botRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/bot/status', { preHandler: fastify.authenticate }, async (request) => {
    return getOrCreateBotState(request.userId);
  });

  fastify.post('/api/bot/start', { preHandler: fastify.authenticate }, async (request) => {
    const state = await updateBotState(request.userId, { status: 'RUNNING' });
    await createSystemEvent({ userId: request.userId, type: 'BOT_START', details: {} });
    return state;
  });

  fastify.post('/api/bot/stop', { preHandler: fastify.authenticate }, async (request) => {
    const state = await updateBotState(request.userId, { status: 'STOPPED' });
    await createSystemEvent({ userId: request.userId, type: 'BOT_STOP', details: {} });
    return state;
  });

  fastify.post('/api/bot/mode/paper', { preHandler: fastify.authenticate }, async (request) => {
    const state = await updateBotState(request.userId, { status: 'PAPER', mode: 'PAPER' });
    await createSystemEvent({ userId: request.userId, type: 'MODE_CHANGE', details: { mode: 'PAPER' } });
    return state;
  });

  // Deliberately refuses right now, independent of ENABLE_LIVE_TRADING: no
  // LiveTradingService exists yet (ships in Phase 13). Letting the bot's
  // mode flip to LIVE today, with the Risk Engine set up to allow it but
  // nothing actually implementing live execution, would be presenting an
  // unfinished feature as if it worked — exactly what the project rules
  // say not to do.
  fastify.post('/api/bot/mode/live', { preHandler: fastify.authenticate }, async (_request, reply) => {
    return reply.code(501).send({
      error: 'Live trading is not implemented yet. It ships in Phase 13 alongside the live execution engine.',
    });
  });

  fastify.post('/api/bot/kill', { preHandler: fastify.authenticate }, async (request) => {
    return activateKillSwitch(request.userId, 'Manual activation from dashboard/API');
  });

  fastify.post('/api/bot/kill/deactivate', { preHandler: fastify.authenticate }, async (request) => {
    return deactivateKillSwitch(request.userId);
  });

  fastify.get('/api/config/live-trading-enabled', { preHandler: fastify.authenticate }, async () => {
    return { enabled: loadConfig().ENABLE_LIVE_TRADING };
  });
}
