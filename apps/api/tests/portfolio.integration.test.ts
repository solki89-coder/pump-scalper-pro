import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { closePool } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { upsertRiskConfig } from '../src/db/repositories/riskConfig.js';
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

describe('GET /api/portfolio', () => {
  it('returns every spec-required field with sane defaults for a brand-new user', async () => {
    const user = await createUser('portfolio@example.com', await hashPassword('password123'));
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'password123' } });
    const { token } = login.json() as { token: string };

    const res = await app.inject({ method: 'GET', url: '/api/portfolio', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      solBalance: 0,
      dailyPnlSol: 0,
      totalPnlSol: 0,
      openPositions: 0,
      tradesToday: 0,
      winRate: 0,
      maxDrawdownPercent: 0,
      botStatus: 'PAPER',
    });
  });

  it('reflects the trading allocation as solBalance once a risk config exists', async () => {
    const user = await createUser('portfolio2@example.com', await hashPassword('password123'));
    await upsertRiskConfig({
      userId: user.id,
      maxPositionSizeSol: 1,
      maxDailyLossSol: 1,
      maxTotalExposureSol: 5,
      maxOpenPositions: 3,
      maxTradesPerDay: 20,
      maxSlippageBps: 500,
      minSolBalance: 0,
      autonomousEnabled: false,
      autonomousMaxPositionSol: null,
      autonomousMaxDailyLossSol: null,
      autonomousMaxTrades: null,
      tradingAllocationSol: 2.5,
    });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'password123' } });
    const { token } = login.json() as { token: string };

    const res = await app.inject({ method: 'GET', url: '/api/portfolio', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()).toMatchObject({ solBalance: 2.5 });
  });
});
