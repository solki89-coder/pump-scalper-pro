import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { closePool } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { upsertToken } from '../src/db/repositories/tokens.js';
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

async function makeUser(email = 'user@example.com', password = 'correct-horse-battery-staple') {
  const user = await createUser(email, await hashPassword(password));
  return { user, password };
}

async function loginAndGetSession(email?: string, password?: string) {
  const { user, password: pw } = await makeUser(email, password);
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: pw } });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { token: string; csrfToken: string };
  const cookies = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { user, token: body.token, csrfToken: body.csrfToken, cookies };
}

describe('GET /health', () => {
  it('responds without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /auth/login', () => {
  it('rejects unknown credentials with 401 and never reveals whether the email exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nope@example.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed request with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
  });

  it('issues a JWT and a CSRF cookie on valid credentials', async () => {
    const { token, csrfToken } = await loginAndGetSession();
    expect(token).toBeTruthy();
    expect(csrfToken).toBeTruthy();
  });
});

describe('authentication middleware', () => {
  it('rejects a protected route with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bot/status' });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a Bearer token', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({ method: 'GET', url: '/api/bot/status', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a cookie session for a GET request without requiring the CSRF header', async () => {
    const { cookies } = await loginAndGetSession();
    const res = await app.inject({ method: 'GET', url: '/api/bot/status', headers: { cookie: cookies } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a cookie-authenticated mutating request missing the CSRF header', async () => {
    const { cookies } = await loginAndGetSession();
    const res = await app.inject({ method: 'POST', url: '/api/bot/start', headers: { cookie: cookies } });
    expect(res.statusCode).toBe(403);
  });

  it('accepts a cookie-authenticated mutating request with a matching CSRF header', async () => {
    const { cookies, csrfToken } = await loginAndGetSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/start',
      headers: { cookie: cookies, 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not require CSRF for a Bearer-authenticated mutating request', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({ method: 'POST', url: '/api/bot/start', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });
});

describe('bot control routes', () => {
  it('defaults bot state to PAPER mode/status', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({ method: 'GET', url: '/api/bot/status', headers: { authorization: `Bearer ${token}` } });
    expect(res.json()).toMatchObject({ status: 'PAPER', mode: 'PAPER', killSwitchActive: false });
  });

  it('activating the kill switch is reflected in subsequent status reads', async () => {
    const { token } = await loginAndGetSession();
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'POST', url: '/api/bot/kill', headers });
    const res = await app.inject({ method: 'GET', url: '/api/bot/status', headers });
    expect(res.json()).toMatchObject({ status: 'KILL_SWITCH', killSwitchActive: true });
  });

  it('refuses to switch the autonomous bot into live mode — manual-only LIVE, by design', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/mode/live',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(501);
  });
});

describe('error handling', () => {
  it('returns 400 with validation details for a malformed :id param instead of a raw 500', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/positions/not-a-uuid/close',
      headers: { authorization: `Bearer ${token}` },
      payload: { maxSlippageBps: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid request');
  });
});

describe('strategies routes', () => {
  const validStrategyBody = {
    name: 'Test Strategy',
    enabled: true,
    autonomous: false,
    tokenAgeSeconds: { min: 0, max: 600 },
    liquiditySol: { min: 1, max: null },
    volumeSolMin: null,
    marketCapSol: { min: null, max: null },
    buySellRatioMin: null,
    uniqueBuyersMin: null,
    holderConcentrationPercentMax: null,
    creatorHoldingPercentMax: null,
    opportunityScoreMin: 85,
    riskScoreMax: 30,
    momentumScoreMin: 70,
    liquidityScoreMin: 60,
    buyPressureScoreMin: 65,
    scoreWeights: { momentumWeight: 1, liquidityWeight: 1, volumeWeight: 1, buyPressureWeight: 1, holderWeight: 1, creatorRiskWeight: 1 },
    positionSizeSol: 0.1,
    stopLossPercent: 15,
    stopLossMode: 'FIXED',
    takeProfitLevels: [{ triggerPercent: 10, sellPercent: 25 }],
    trailingStopPercent: 10,
    maxHoldingTimeSeconds: 600,
    maxPositions: 3,
    maxTradesPerDay: 20,
    maxDailyLossSol: 0.5,
    maxSlippageBps: 500,
  };

  it('creates, lists, updates, and deletes a strategy scoped to the authenticated user', async () => {
    const { token } = await loginAndGetSession();
    const headers = { authorization: `Bearer ${token}` };

    const created = await app.inject({ method: 'POST', url: '/api/strategies', headers, payload: validStrategyBody });
    expect(created.statusCode).toBe(201);
    const strategy = created.json();

    const list = await app.inject({ method: 'GET', url: '/api/strategies', headers });
    expect(list.json()).toHaveLength(1);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/strategies/${strategy.id}`,
      headers,
      payload: { ...validStrategyBody, positionSizeSol: 0.2 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().positionSizeSol).toBe(0.2);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/strategies/${strategy.id}`, headers });
    expect(deleted.statusCode).toBe(204);
  });

  it('rejects a strategy whose take-profit levels sum over 100%', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...validStrategyBody, takeProfitLevels: [{ triggerPercent: 10, sellPercent: 60 }, { triggerPercent: 20, sellPercent: 60 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("one user cannot update another user's strategy", async () => {
    const { token: tokenA } = await loginAndGetSession('a@example.com');
    const created = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: validStrategyBody,
    });
    const strategyId = created.json().id;

    const { token: tokenB } = await loginAndGetSession('b@example.com');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/strategies/${strategyId}`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: validStrategyBody,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('manual buy through /api/positions', () => {
  it('rejects a buy when no risk configuration exists yet', async () => {
    const { token, user } = await loginAndGetSession();
    await upsertToken({
      mint: 'Mint1',
      name: 'Doge Killer',
      symbol: 'DOGEK',
      creator: 'Creator1',
      ageSeconds: 60,
      priceSol: 0.00001,
      marketCapSol: 20,
      liquiditySol: 10,
      volumeSol5m: 2,
      buys5m: 10,
      sells5m: 2,
      uniqueBuyers5m: null,
      uniqueSellers5m: null,
      holders: null,
      creatorHoldingPercent: null,
      topHolderConcentrationPercent: null,
      bondingCurveStatus: 'ACTIVE',
      graduationStatus: 'NOT_GRADUATED',
      observedAt: new Date().toISOString(),
    });
    void user;
    const res = await app.inject({
      method: 'POST',
      url: '/api/positions',
      headers: { authorization: `Bearer ${token}` },
      payload: { mint: 'Mint1', sizeSol: 0.1, stopLossPercent: 15, maxSlippageBps: 2000 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('opens a position when the risk config allows it, and blocks a second buy once MAX_OPEN_POSITIONS is hit', async () => {
    const { token, user } = await loginAndGetSession();
    await upsertRiskConfig({
      userId: user.id,
      maxPositionSizeSol: 1,
      maxDailyLossSol: 1,
      maxTotalExposureSol: 5,
      maxOpenPositions: 1,
      maxTradesPerDay: 20,
      maxSlippageBps: 5000,
      minSolBalance: 0,
      autonomousEnabled: false,
      autonomousMaxPositionSol: null,
      autonomousMaxDailyLossSol: null,
      autonomousMaxTrades: null,
      tradingAllocationSol: 5,
    });
    for (const mint of ['Mint1', 'Mint2']) {
      await upsertToken({
        mint,
        name: 'Doge Killer',
        symbol: 'DOGEK',
        creator: 'Creator1',
        ageSeconds: 60,
        priceSol: 0.00001,
        marketCapSol: 20,
        liquiditySol: 10,
        volumeSol5m: 2,
        buys5m: 10,
        sells5m: 2,
        uniqueBuyers5m: null,
        uniqueSellers5m: null,
        holders: null,
        creatorHoldingPercent: null,
        topHolderConcentrationPercent: null,
        bondingCurveStatus: 'ACTIVE',
        graduationStatus: 'NOT_GRADUATED',
        observedAt: new Date().toISOString(),
      });
    }

    const headers = { authorization: `Bearer ${token}` };
    const first = await app.inject({
      method: 'POST',
      url: '/api/positions',
      headers,
      payload: { mint: 'Mint1', sizeSol: 0.1, stopLossPercent: 15, maxSlippageBps: 5000 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/positions',
      headers,
      payload: { mint: 'Mint2', sizeSol: 0.1, stopLossPercent: 15, maxSlippageBps: 5000 },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().reasons).toContain('MAX_OPEN_POSITIONS');
  });
});

describe('GET /api/analytics', () => {
  it('returns zeroed analytics with no trade history', async () => {
    const { token } = await loginAndGetSession();
    const res = await app.inject({ method: 'GET', url: '/api/analytics', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ totalTrades: 0, totalPnlSol: 0 });
  });
});
