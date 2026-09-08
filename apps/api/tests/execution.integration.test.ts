import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { closePool } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { buildServer } from '../src/server.js';
import { ensureTestSchema, truncateAll } from './dbTestUtils.js';

let app: FastifyInstance;

beforeAll(async () => {
  await ensureTestSchema();
  app = await buildServer();
  await app.ready();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function loginToken(email = 'exec@example.com', password = 'password123') {
  await createUser(email, await hashPassword(password));
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  return (res.json() as { token: string }).token;
}

// ENABLE_LIVE_TRADING defaults to false in the test environment (tests/setup.ts) —
// exactly the spec's default, and exactly why both routes must refuse before
// ever reaching the network (Jupiter / Solana RPC), which this test suite
// deliberately never calls for real. See README's Live Execution Adapter
// section for what is and isn't verified by tests versus a real browser run.
describe('POST /api/execution/quote', () => {
  it('refuses with 403 when ENABLE_LIVE_TRADING is not set, before validating the body or touching the network', async () => {
    const token = await loginToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/execution/quote',
      headers: { authorization: `Bearer ${token}` },
      payload: { mint: 'not-even-a-valid-request' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('ENABLE_LIVE_TRADING');
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/execution/quote', payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/execution/confirm', () => {
  it('refuses with 403 when ENABLE_LIVE_TRADING is not set', async () => {
    const token = await loginToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/execution/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('ENABLE_LIVE_TRADING');
  });
});
