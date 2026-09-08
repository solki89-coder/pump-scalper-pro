import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';
import analyticsRoutes from './routes/analytics.js';
import authRoutes from './routes/auth.js';
import botRoutes from './routes/bot.js';
import executionRoutes from './routes/execution.js';
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
  // Fastify's default request/response log lines don't include headers or
  // body already (just method/url/host/remoteAddress), so this redact
  // list is defense-in-depth rather than a fix for an active leak — it
  // keeps the JWT/session cookie and Authorization header out of logs
  // even if something later logs a raw request/response object directly
  // (a debug log, an error dump) instead of through Fastify's serializer.
  const fastify = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
  });

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

  // Phase 14 security audit: Fastify's built-in default error handler
  // forwards a thrown error's own `.message` straight into the JSON
  // response for ANY status code, including 500s — so an uncaught
  // exception (a raw pg error, a bug in a repository query) would leak
  // internal detail (table/column names, stack-adjacent context) to the
  // client by default. Route-level validation errors that use
  // `safeParse` and explicit `reply.code(4xx).send(...)` never reach
  // this handler at all. A few route params/query schemas use zod's
  // `.parse()` directly (throwing `ZodError` on bad input, e.g. an
  // `:id` that isn't a UUID) instead of `safeParse` — that's genuinely
  // a 400 (bad client input), not a 500, so it's special-cased here
  // rather than falling through to "Internal server error."
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: 'Invalid request', details: error.issues });
      return;
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      reply.code(statusCode).send({ error: 'Internal server error' });
      return;
    }
    reply.code(statusCode).send({ error: error.message });
  });

  await fastify.register(securityPlugin);
  await fastify.register(authPlugin);
  await fastify.register(fastifyWebsocket);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(botRoutes);
  await fastify.register(portfolioRoutes);
  await fastify.register(positionRoutes);
  await fastify.register(executionRoutes);
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

  const { startRuntimeLoop } = await import('./loop.js');
  const runtimeLoop = startRuntimeLoop(fastify.log);

  const { createTelegramBot } = await import('./telegram/index.js');
  const telegramBot = createTelegramBot();
  if (telegramBot) {
    fastify.log.info('Starting Telegram bot (long polling)');
    void telegramBot.start({ onStart: () => fastify.log.info('Telegram bot ready') });
  } else {
    fastify.log.warn('TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — Telegram integration disabled.');
  }

  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await runtimeLoop.stop();
    if (telegramBot) await telegramBot.stop();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await fastify.listen({ port: config.API_PORT, host: '0.0.0.0' });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
