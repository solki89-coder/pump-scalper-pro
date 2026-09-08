import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';
import analyticsRoutes from './routes/analytics.js';
import authRoutes from './routes/auth.js';
import botRoutes from './routes/bot.js';
import healthRoutes from './routes/health.js';
import portfolioRoutes from './routes/portfolio.js';
import positionRoutes from './routes/positions.js';
import riskRoutes from './routes/risk.js';
import strategyRoutes from './routes/strategies.js';
import tokenRoutes from './routes/tokens.js';
import tradeRoutes from './routes/trades.js';
import walletRoutes from './routes/wallet.js';
import registerWsHub from './ws/hub.js';

/** Builds the app without starting it — the entry point tests use (fastify.inject(), no open port). */
export async function buildServer(): Promise<FastifyInstance> {
  const config = loadConfig();
  const fastify = Fastify({ logger: { level: config.LOG_LEVEL } });

  // A bodyless action (POST /api/bot/start and friends) sent with
  // Content-Type: application/json but zero bytes is reasonable client
  // behavior, not a malformed request — treat it as `{}` instead of
  // Fastify's default 400. Routes that need real fields still validate
  // them via zod and reject a missing/invalid body themselves.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (typeof body !== 'string' || body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await fastify.register(securityPlugin);
  await fastify.register(authPlugin);
  await fastify.register(fastifyWebsocket);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(botRoutes);
  await fastify.register(portfolioRoutes);
  await fastify.register(positionRoutes);
  await fastify.register(strategyRoutes);
  await fastify.register(riskRoutes);
  await fastify.register(tradeRoutes);
  await fastify.register(analyticsRoutes);
  await fastify.register(tokenRoutes);
  await fastify.register(walletRoutes);
  await fastify.register(registerWsHub);

  return fastify;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const fastify = await buildServer();
  const { ensureAdminUser } = await import('./auth/bootstrap.js');
  await ensureAdminUser(fastify.log);
  await fastify.listen({ port: config.API_PORT, host: '0.0.0.0' });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
