import { describe, expect, it } from 'vitest';
import { StrategyConfigSchema, TokenSnapshotSchema, DEFAULT_SCORE_WEIGHTS } from '../src/index.js';

describe('shared schemas', () => {
  it('parses a minimal valid token snapshot', () => {
    const result = TokenSnapshotSchema.safeParse({
      mint: '11111111111111111111111111111111',
      name: 'Test Token',
      symbol: 'TEST',
      creator: '11111111111111111111111111111111',
      ageSeconds: 42,
      priceSol: 0.00001,
      marketCapSol: 30,
      liquiditySol: 5,
      volumeSol5m: 1,
      buys5m: 3,
      sells5m: 1,
      uniqueBuyers5m: 3,
      uniqueSellers5m: 1,
      holders: null,
      creatorHoldingPercent: null,
      topHolderConcentrationPercent: null,
      bondingCurveStatus: 'ACTIVE',
      graduationStatus: 'NOT_GRADUATED',
      observedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a strategy whose take-profit levels sell more than 100%', () => {
    const result = StrategyConfigSchema.safeParse({
      userId: '11111111-1111-1111-1111-111111111111',
      name: 'Too greedy',
      tokenAgeSeconds: { min: null, max: null },
      liquiditySol: { min: null, max: null },
      volumeSolMin: null,
      marketCapSol: { min: null, max: null },
      buySellRatioMin: null,
      uniqueBuyersMin: null,
      holderConcentrationPercentMax: null,
      creatorHoldingPercentMax: null,
      positionSizeSol: 0.1,
      stopLossPercent: 10,
      takeProfitLevels: [
        { triggerPercent: 10, sellPercent: 60 },
        { triggerPercent: 20, sellPercent: 60 },
      ],
      trailingStopPercent: null,
      maxHoldingTimeSeconds: null,
      maxPositions: 3,
      maxTradesPerDay: 20,
      maxDailyLossSol: 1,
      maxSlippageBps: 500,
    });
    expect(result.success).toBe(false);
  });

  it('exposes default score weights', () => {
    expect(Object.values(DEFAULT_SCORE_WEIGHTS).every((w) => w === 1)).toBe(true);
  });
});
