import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { loadConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * JWT auth (Bearer header for API clients, or an httpOnly cookie for the
 * browser dashboard) plus CSRF protection for the cookie path specifically
 * — a Bearer token isn't attached automatically by a browser to a
 * cross-site request, so it isn't CSRF-vulnerable the way a cookie is; a
 * request authenticated via cookie on a mutating method must also echo a
 * `x-csrf-token` header matching the non-httpOnly `csrf_token` cookie
 * issued at login (double-submit pattern).
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  const config = loadConfig();
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const usedCookie = !request.headers.authorization && Boolean(request.cookies['token']);
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const payload = request.user as { sub: string };
    request.userId = payload.sub;

    if (usedCookie && MUTATING_METHODS.has(request.method)) {
      const csrfCookie = request.cookies['csrf_token'];
      const csrfHeader = request.headers['x-csrf-token'];
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        reply.code(403).send({ error: 'CSRF token missing or invalid' });
        return;
      }
    }
  });
});
