import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyPassword } from '../auth/passwords.js';
import { loadConfig } from '../config.js';
import { createSystemEvent } from '../db/repositories/systemEvents.js';
import { getUserByEmail } from '../db/repositories/users.js';

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12h, matches the JWT's own expiresIn below

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Kept generous under NODE_ENV=test so a single test file's many
  // independent login calls (each setting up its own user/session) don't
  // trip the same brute-force guard real login attempts are meant to hit.
  const loginRateLimit = loadConfig().NODE_ENV === 'test' ? 10_000 : 5;

  fastify.post(
    '/auth/login',
    { config: { rateLimit: { max: loginRateLimit, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = LoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
      }
      const { email, password } = parsed.data;

      const user = await getUserByEmail(email);
      const valid = user ? await verifyPassword(password, user.passwordHash) : false;
      if (!user || !valid) {
        await createSystemEvent({ userId: user?.id ?? null, type: 'AUTH_LOGIN_FAILED', details: { email } });
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const config = loadConfig();
      const token = fastify.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '12h' });
      const csrfToken = randomBytes(32).toString('hex');
      const cookieOpts = {
        secure: config.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/',
        maxAge: COOKIE_MAX_AGE_SECONDS,
      };
      reply.setCookie('token', token, { ...cookieOpts, httpOnly: true });
      reply.setCookie('csrf_token', csrfToken, { ...cookieOpts, httpOnly: false });

      await createSystemEvent({ userId: user.id, type: 'AUTH_LOGIN', details: {} });
      return { token, csrfToken, userId: user.id, email: user.email };
    },
  );

  fastify.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' });
    reply.clearCookie('csrf_token', { path: '/' });
    return { ok: true };
  });
}
