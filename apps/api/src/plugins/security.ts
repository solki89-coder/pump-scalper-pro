import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { loadConfig } from '../config.js';

export default fp(async function securityPlugin(fastify: FastifyInstance) {
  const config = loadConfig();

  await fastify.register(fastifyCors, {
    origin: config.NODE_ENV === 'production' ? false : true, // same-origin only in prod unless explicitly configured (Phase 14 wires a real allow-list)
    credentials: true,
  });

  await fastify.register(fastifyRateLimit, {
    global: true,
    // Generous under test so a single suite's request volume against one
    // long-lived injected app instance doesn't trip the same guard real
    // traffic is meant to hit.
    max: config.NODE_ENV === 'test' ? 10_000 : 100,
    timeWindow: '1 minute',
  });
});
