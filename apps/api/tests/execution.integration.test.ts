import { Keypair } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { _resetConfigCacheForTests } from '../src/config.js';
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

// Phase 14 security audit: verifies the wallet-ownership check added to
// close a real gap — without it, an authenticated caller could name any
// real (but unconnected) public key as userPublicKey. Both routes check
// wallet ownership before ever touching the network (Jupiter or Solana
// RPC), so this is reachable with ENABLE_LIVE_TRADING=true and no
// network access, unlike the actual quote/swap paths beyond it.
describe('execution routes require a connected wallet', () => {
  let liveApp: FastifyInstance;

  beforeAll(async () => {
    process.env.ENABLE_LIVE_TRADING = 'true';
    _resetConfigCacheForTests();
    liveApp = await buildServer();
    await liveApp.ready();
  });

  afterAll(async () => {
    await liveApp.close();
    delete process.env.ENABLE_LIVE_TRADING;
    _resetConfigCacheForTests();
  });

  it('refuses a quote for a public key that was never connected via POST /api/wallet/connect', async () => {
    const email = 'unconnected-wallet@example.com';
    await createUser(email, await hashPassword('password123'));
    const loginRes = await liveApp.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'password123' } });
    const token = (loginRes.json() as { token: string }).token;

    const res = await liveApp.inject({
      method: 'POST',
      url: '/api/execution/quote',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mint: 'SomeMint1111111111111111111111111111111111',
        side: 'BUY',
        sizeSol: 0.1,
        maxSlippageBps: 500,
        userPublicKey: Keypair.generate().publicKey.toBase58(),
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('not a wallet connected to your account');
  });

  it('refuses a confirm for a public key that was never connected, even with a plausible-looking body', async () => {
    const email = 'unconnected-wallet-2@example.com';
    await createUser(email, await hashPassword('password123'));
    const loginRes = await liveApp.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'password123' } });
    const token = (loginRes.json() as { token: string }).token;

    const res = await liveApp.inject({
      method: 'POST',
      url: '/api/execution/confirm',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mint: 'SomeMint1111111111111111111111111111111111',
        side: 'BUY',
        txSignature: 'sig1',
        userPublicKey: Keypair.generate().publicKey.toBase58(),
        maxSlippageBps: 500,
        stopLossPercent: 15,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('not a wallet connected to your account');
  });

  it('passes the ownership check once the wallet is connected, failing later only on the (network-dependent) risk/quote step', async () => {
    const email = 'connected-wallet@example.com';
    await createUser(email, await hashPassword('password123'));
    const loginRes = await liveApp.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'password123' } });
    const token = (loginRes.json() as { token: string }).token;
    const headers = { authorization: `Bearer ${token}` };

    const publicKey = Keypair.generate().publicKey.toBase58();
    await liveApp.inject({ method: 'POST', url: '/api/wallet/connect', headers, payload: { publicKey, label: 'main' } });

    const res = await liveApp.inject({
      method: 'POST',
      url: '/api/execution/quote',
      headers,
      payload: { mint: 'SomeMint1111111111111111111111111111111111', side: 'BUY', sizeSol: 0.1, maxSlippageBps: 500, userPublicKey: publicKey },
    });
    // Ownership passed (not 403 for the wallet-connection reason); it now
    // fails downstream because there's no risk config / no real network in
    // this sandbox — not what this test is verifying.
    expect(res.statusCode).not.toBe(403);
  });
});
