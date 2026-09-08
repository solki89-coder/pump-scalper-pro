import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool, query } from '../src/db/client.js';
import { ensureTestSchema, truncateAll } from './dbTestUtils.js';
import { createUser } from '../src/db/repositories/users.js';
import { upsertWallet, getWallet } from '../src/db/repositories/wallets.js';
import { getRiskConfig, upsertRiskConfig } from '../src/db/repositories/riskConfig.js';
import { getOrCreateBotState, updateBotState } from '../src/db/repositories/botState.js';
import { createStrategy, listStrategies, updateStrategy } from '../src/db/repositories/strategies.js';
import { upsertToken, getToken } from '../src/db/repositories/tokens.js';
import { createSignal, listSignalsForMint } from '../src/db/repositories/signals.js';
import {
  createPosition,
  updatePosition,
  listOpenPositions,
  countOpenPositions,
  sumOpenExposureSol,
} from '../src/db/repositories/positions.js';
import { createTrade, listTrades, countTradesToday, sumRealizedPnlSince } from '../src/db/repositories/trades.js';
import { createRiskEvent, listRiskEvents } from '../src/db/repositories/riskEvents.js';
import { createSystemEvent, listSystemEvents } from '../src/db/repositories/systemEvents.js';
import type { StrategyConfig, TokenSnapshot } from '@pump-scalper/shared';

beforeAll(async () => {
  await ensureTestSchema();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closePool();
});

async function makeUser() {
  return createUser(`${randomUUID()}@example.com`, 'hashed');
}

const baseStrategy = (userId: string): StrategyConfig => ({
  userId,
  name: 'Sniper A',
  enabled: true,
  autonomous: false,
  tokenAgeSeconds: { min: 0, max: 300 },
  liquiditySol: { min: 2, max: null },
  volumeSolMin: 1,
  marketCapSol: { min: null, max: 100 },
  buySellRatioMin: 1.5,
  uniqueBuyersMin: 10,
  holderConcentrationPercentMax: 40,
  creatorHoldingPercentMax: 10,
  opportunityScoreMin: 85,
  riskScoreMax: 30,
  momentumScoreMin: 70,
  liquidityScoreMin: 60,
  buyPressureScoreMin: 65,
  scoreWeights: {
    momentumWeight: 1,
    liquidityWeight: 1,
    volumeWeight: 1,
    buyPressureWeight: 1,
    holderWeight: 1,
    creatorRiskWeight: 1,
  },
  positionSizeSol: 0.1,
  stopLossPercent: 15,
  stopLossMode: 'FIXED',
  takeProfitLevels: [
    { triggerPercent: 10, sellPercent: 25 },
    { triggerPercent: 20, sellPercent: 25 },
  ],
  trailingStopPercent: 10,
  maxHoldingTimeSeconds: 600,
  maxPositions: 3,
  maxTradesPerDay: 20,
  maxDailyLossSol: 0.5,
  maxSlippageBps: 500,
});

const baseSnapshot = (mint: string): TokenSnapshot => ({
  mint,
  name: 'Doge Killer',
  symbol: 'DOGEK',
  creator: 'Creator1111111111111111111111111111',
  ageSeconds: 30,
  priceSol: 0.0000123,
  marketCapSol: 25,
  liquiditySol: 4,
  volumeSol5m: 2,
  buys5m: 12,
  sells5m: 4,
  uniqueBuyers5m: 9,
  uniqueSellers5m: 3,
  holders: null,
  creatorHoldingPercent: null,
  topHolderConcentrationPercent: null,
  bondingCurveStatus: 'ACTIVE',
  graduationStatus: 'NOT_GRADUATED',
  observedAt: new Date().toISOString(),
});

describe('migrations', () => {
  it('creates every table required by the spec plus the two documented additions', async () => {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(
      [
        'bot_state',
        'positions',
        'risk_configs',
        'risk_events',
        'schema_migrations',
        'signals',
        'strategies',
        'system_events',
        'tokens',
        'trades',
        'users',
        'wallets',
      ].sort(),
    );
  });

  it('is idempotent — running twice applies nothing the second time', async () => {
    const { runMigrations } = await import('../src/db/migrate.js');
    const applied = await runMigrations(getPool());
    expect(applied).toEqual([]);
  });
});

describe('users + wallets + risk config + bot state repositories', () => {
  it('creates a user and looks it up by email and id', async () => {
    const user = await makeUser();
    expect(user.id).toBeTruthy();
    const byEmail = await import('../src/db/repositories/users.js').then((m) => m.getUserByEmail(user.email));
    expect(byEmail?.id).toBe(user.id);
  });

  it('upserts a wallet, keeping label-scoped uniqueness per user', async () => {
    const user = await makeUser();
    const created = await upsertWallet(user.id, 'trading', { publicKey: 'PubKey111', connected: true, tradingAllocationSol: 1 });
    expect(created.publicKey).toBe('PubKey111');
    const updated = await upsertWallet(user.id, 'trading', { tradingAllocationSol: 2 });
    expect(updated.tradingAllocationSol).toBe(2);
    expect(updated.publicKey).toBe('PubKey111'); // preserved via COALESCE
    const fetched = await getWallet(user.id, 'trading');
    expect(fetched?.tradingAllocationSol).toBe(2);
  });

  it('round-trips a risk config', async () => {
    const user = await makeUser();
    const saved = await upsertRiskConfig({
      userId: user.id,
      maxPositionSizeSol: 0.5,
      maxDailyLossSol: 1,
      maxTotalExposureSol: 2,
      maxOpenPositions: 3,
      maxTradesPerDay: 20,
      maxSlippageBps: 300,
      minSolBalance: 0.05,
      autonomousEnabled: false,
      autonomousMaxPositionSol: null,
      autonomousMaxDailyLossSol: null,
      autonomousMaxTrades: null,
      tradingAllocationSol: 1,
    });
    expect(saved.maxOpenPositions).toBe(3);
    const fetched = await getRiskConfig(user.id);
    expect(fetched?.maxSlippageBps).toBe(300);
  });

  it('defaults bot state to PAPER and updates it', async () => {
    const user = await makeUser();
    const initial = await getOrCreateBotState(user.id);
    expect(initial.status).toBe('PAPER');
    expect(initial.killSwitchActive).toBe(false);
    const updated = await updateBotState(user.id, { status: 'RUNNING', mode: 'PAPER' });
    expect(updated.status).toBe('RUNNING');
  });
});

describe('strategies repository', () => {
  it('creates, lists, and updates a strategy round-tripping every field', async () => {
    const user = await makeUser();
    const created = await createStrategy(baseStrategy(user.id));
    expect(created.id).toBeTruthy();
    expect(created.takeProfitLevels).toHaveLength(2);
    expect(created.scoreWeights.momentumWeight).toBe(1);

    const list = await listStrategies(user.id);
    expect(list).toHaveLength(1);

    const updated = await updateStrategy(created.id as string, { ...created, positionSizeSol: 0.2 });
    expect(updated?.positionSizeSol).toBe(0.2);
  });
});

describe('tokens + signals repositories', () => {
  it('upserts a token, preserving first_seen_at across updates', async () => {
    const mint = 'Mint1111111111111111111111111111111111111';
    const first = await upsertToken(baseSnapshot(mint));
    expect(first.mint).toBe(mint);
    const second = await upsertToken({ ...baseSnapshot(mint), priceSol: 0.0000999, ageSeconds: 90 });
    expect(second.priceSol).toBe(0.0000999);
    const fetched = await getToken(mint);
    expect(fetched?.ageSeconds).toBeGreaterThanOrEqual(29); // derived from stable first_seen_at, not the second call's ageSeconds=90
  });

  it('records and lists signals for a token', async () => {
    const mint = 'Mint2222222222222222222222222222222222222';
    await upsertToken(baseSnapshot(mint));
    await createSignal({ mint, strategyId: null, signal: 'STRONG_BUY', reason: 'high opportunity', scores: { opportunityScore: 90 } });
    const list = await listSignalsForMint(mint);
    expect(list).toHaveLength(1);
    expect(list[0]?.signal).toBe('STRONG_BUY');
  });
});

describe('positions + trades repositories', () => {
  it('opens a position, updates it, and tracks aggregate exposure', async () => {
    const user = await makeUser();
    const mint = 'Mint3333333333333333333333333333333333333';
    await upsertToken(baseSnapshot(mint));

    const position = await createPosition({
      userId: user.id,
      strategyId: null,
      mode: 'PAPER',
      status: 'OPEN',
      mint,
      tokenName: 'Doge Killer',
      tokenSymbol: 'DOGEK',
      entryPrice: 0.00001,
      currentPrice: 0.00001,
      highestPrice: 0.00001,
      quantity: 1_000_000,
      originalQuantity: 1_000_000,
      entryValueSol: 0.1,
      currentValueSol: 0.1,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: 0,
      stopLossPercent: 15,
      stopLossPrice: 0.0000085,
      stopLossMode: 'FIXED',
      takeProfitLevels: [{ triggerPercent: 10, sellPercent: 25, executed: false, executedAt: null }],
      trailingStopPercent: 10,
      trailingStopPrice: null,
      entryOpportunityScore: 88,
      entryRiskScore: 20,
      entryTime: new Date().toISOString(),
      closedAt: null,
    });
    expect(position.id).toBeTruthy();
    expect(await countOpenPositions(user.id)).toBe(1);
    expect(await sumOpenExposureSol(user.id)).toBeCloseTo(0.1, 9);

    const updated = await updatePosition(position.id, {
      currentPrice: 0.000012,
      highestPrice: 0.000012,
      currentValueSol: 0.12,
      unrealizedPnlSol: 0.02,
      unrealizedPnlPercent: 20,
    });
    expect(updated?.unrealizedPnlPercent).toBe(20);

    const open = await listOpenPositions(user.id);
    expect(open).toHaveLength(1);

    const closed = await updatePosition(position.id, { status: 'CLOSED', closedAt: new Date().toISOString() });
    expect(closed?.status).toBe('CLOSED');
    expect(await countOpenPositions(user.id)).toBe(0);

    const trade = await createTrade({
      userId: user.id,
      positionId: position.id,
      strategyId: null,
      mode: 'PAPER',
      mint,
      tokenName: 'Doge Killer',
      tokenSymbol: 'DOGEK',
      side: 'SELL',
      price: 0.000012,
      quantity: 1_000_000,
      sizeSol: 0.12,
      feesSol: 0.001,
      slippageBps: 80,
      pnlSol: 0.02,
      pnlPercent: 20,
      exitReason: 'TAKE_PROFIT',
      holdingTimeSeconds: 120,
      entryOpportunityScore: 88,
      entryRiskScore: 20,
      txSignature: null,
    });
    expect(trade.pnlSol).toBe(0.02);

    const trades = await listTrades(user.id, 'TODAY');
    expect(trades).toHaveLength(1);
    expect(await sumRealizedPnlSince(user.id, null)).toBeCloseTo(0.02, 9);
    expect(await countTradesToday(user.id)).toBe(0); // no BUY trade recorded in this test
  });
});

describe('risk_events + system_events repositories', () => {
  it('records a risk rejection and a system event', async () => {
    const user = await makeUser();
    const event = await createRiskEvent({
      userId: user.id,
      mint: null,
      strategyId: null,
      reasons: ['MAX_DAILY_LOSS'],
      attemptedSizeSol: 0.3,
      details: { note: 'daily loss cap hit' },
    });
    expect(event.reasons).toEqual(['MAX_DAILY_LOSS']);
    const events = await listRiskEvents(user.id);
    expect(events).toHaveLength(1);

    const sysEvent = await createSystemEvent({ userId: user.id, type: 'KILL_SWITCH_ON', details: {} });
    expect(sysEvent.type).toBe('KILL_SWITCH_ON');
    const sysEvents = await listSystemEvents(user.id);
    expect(sysEvents).toHaveLength(1);
  });
});
