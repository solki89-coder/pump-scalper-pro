import { PaperExecutionEngine } from '@pump-scalper/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, getPool } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { upsertToken } from '../src/db/repositories/tokens.js';
import { createPosition, updatePosition, getPosition } from '../src/db/repositories/positions.js';
import { createTrade } from '../src/db/repositories/trades.js';
import { PaperTradingService } from '../src/trading/paperTradingService.js';
import { ensureTestSchema, truncateAll } from './dbTestUtils.js';

beforeAll(async () => {
  await ensureTestSchema();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closePool();
});

describe('PaperTradingService against real Postgres', () => {
  it('opens and closes a position end to end, persisting through the real repositories', async () => {
    const user = await createUser(`${randomUUID()}@example.com`, 'hashed');
    const mint = 'Mint1111111111111111111111111111111111111';
    await upsertToken({
      mint,
      name: 'Doge Killer',
      symbol: 'DOGEK',
      creator: 'Creator111111111111111111111111111111111',
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

    const service = new PaperTradingService(new PaperExecutionEngine(), { createPosition, updatePosition, getPosition }, {
      createTrade,
    });

    const { position } = await service.openPosition({
      userId: user.id,
      strategyId: null,
      mint,
      tokenName: 'Doge Killer',
      tokenSymbol: 'DOGEK',
      sizeSol: 0.2,
      currentPriceSol: 0.00001,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      stopLossPercent: 15,
      stopLossMode: 'FIXED',
      takeProfitLevels: [{ triggerPercent: 10, sellPercent: 50 }],
      trailingStopPercent: null,
      entryOpportunityScore: 90,
      entryRiskScore: 15,
    });

    const rows = await getPool().query('SELECT * FROM positions WHERE id = $1', [position.id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].status).toBe('OPEN');

    const { position: closed, trade } = await service.closePosition({
      positionId: position.id,
      currentPriceSol: 0.000012,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });

    expect(closed.status).toBe('CLOSED');
    const tradeRows = await getPool().query('SELECT * FROM trades WHERE position_id = $1 ORDER BY executed_at', [position.id]);
    expect(tradeRows.rows).toHaveLength(2);
    expect(tradeRows.rows[1].side).toBe('SELL');
    expect(Number(tradeRows.rows[1].pnl_sol)).toBe(trade.pnlSol);
  });
});
