import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { loadConfig } from '../config.js';

export default fp(async function securityPlugin(fastify: FastifyInstance) {
  const config = loadConfig();

  // Outside production, CORS stays wide open (`origin: true`) for local
  // dev convenience (web on :3000, API on :4000, no fixed origin to pin
  // to). In production, CORS_ORIGIN is the explicit allow-list — unset
  // means no cross-origin browser request is allowed at all, not "allow
  // everything." A same-origin deployment (dashboard served by the same
  // origin/reverse proxy as the API) needs no CORS_ORIGIN at all.
  const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  await fastify.register(fastifyCors, {
    origin: config.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
  });

  // Sets standard defensive headers (X-Content-Type-Options, X-Frame-Options,
  // Strict-Transport-Security, Referrer-Policy, etc). CSP is left at
  // helmet's default (script-src 'self', etc), which is fine for a JSON
  // API with no HTML views of its own; the Next.js dashboard is a
  // separate process with its own headers.
  await fastify.register(fastifyHelmet);

  await fastify.register(fastifyRateLimit, {
    global: true,
    // Generous under test so a single suite's request volume against one
    // long-lived injected app instance doesn't trip the same guard real
    // traffic is meant to hit.
    max: config.NODE_ENV === 'test' ? 10_000 : 100,
    timeWindow: '1 minute',
  });
});
