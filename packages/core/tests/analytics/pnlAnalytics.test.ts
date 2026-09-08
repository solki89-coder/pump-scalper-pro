import type { Trade } from '@pump-scalper/shared';
import { describe, expect, it } from 'vitest';
import { computePnlAnalytics } from '../../src/analytics/pnlAnalytics.js';

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: '1',
    userId: 'u1',
    positionId: 'p1',
    strategyId: null,
    mode: 'PAPER',
    mint: 'M1',
    tokenName: 'T',
    tokenSymbol: 'T',
    side: 'SELL',
    price: 1,
    quantity: 1,
    sizeSol: 1,
    feesSol: 0,
    slippageBps: 0,
    pnlSol: 0,
    pnlPercent: 0,
    exitReason: 'TAKE_PROFIT',
    holdingTimeSeconds: 100,
    entryOpportunityScore: 80,
    entryRiskScore: 20,
    txSignature: null,
    executedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computePnlAnalytics', () => {
  it('returns all-zero/null analytics for no trades', () => {
    const result = computePnlAnalytics([]);
    expect(result.totalTrades).toBe(0);
    expect(result.totalPnlSol).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.profitFactor).toBeNull();
    expect(result.averageWinSol).toBeNull();
    expect(result.bestTradeSol).toBeNull();
  });

  it('ignores BUY trades entirely — only realized SELL trades count', () => {
    const result = computePnlAnalytics([trade({ side: 'BUY', pnlSol: null })]);
    expect(result.totalTrades).toBe(0);
  });

  it('computes totalPnlSol, winRate, and lossRate over a mix of wins and losses', () => {
    const trades = [
      trade({ id: '1', pnlSol: 0.05 }),
      trade({ id: '2', pnlSol: -0.02 }),
      trade({ id: '3', pnlSol: 0.03 }),
      trade({ id: '4', pnlSol: -0.01 }),
    ];
    const result = computePnlAnalytics(trades);
    expect(result.totalTrades).toBe(4);
    expect(result.winningTrades).toBe(2);
    expect(result.losingTrades).toBe(2);
    expect(result.winRate).toBe(50);
    expect(result.lossRate).toBe(50);
    expect(result.totalPnlSol).toBeCloseTo(0.05);
  });

  it('computes profitFactor as gross profit / gross loss', () => {
    const trades = [trade({ id: '1', pnlSol: 0.1 }), trade({ id: '2', pnlSol: -0.05 })];
    const result = computePnlAnalytics(trades);
    expect(result.profitFactor).toBeCloseTo(2, 9);
  });

  it('returns null profitFactor when there are no losses to divide by', () => {
    const trades = [trade({ id: '1', pnlSol: 0.1 })];
    const result = computePnlAnalytics(trades);
    expect(result.profitFactor).toBeNull();
  });

  it('computes averageWinSol and averageLossSol separately', () => {
    const trades = [
      trade({ id: '1', pnlSol: 0.1 }),
      trade({ id: '2', pnlSol: 0.3 }),
      trade({ id: '3', pnlSol: -0.05 }),
      trade({ id: '4', pnlSol: -0.15 }),
    ];
    const result = computePnlAnalytics(trades);
    expect(result.averageWinSol).toBeCloseTo(0.2, 9);
    expect(result.averageLossSol).toBeCloseTo(-0.1, 9);
  });

  it('finds bestTradeSol and worstTradeSol', () => {
    const trades = [trade({ id: '1', pnlSol: 0.5 }), trade({ id: '2', pnlSol: -0.3 }), trade({ id: '3', pnlSol: 0.1 })];
    const result = computePnlAnalytics(trades);
    expect(result.bestTradeSol).toBe(0.5);
    expect(result.worstTradeSol).toBe(-0.3);
  });

  it('computes averageHoldingTimeSeconds, ignoring trades with unknown holding time', () => {
    const trades = [trade({ id: '1', holdingTimeSeconds: 100 }), trade({ id: '2', holdingTimeSeconds: 300 }), trade({ id: '3', holdingTimeSeconds: null })];
    const result = computePnlAnalytics(trades);
    expect(result.averageHoldingTimeSeconds).toBe(200);
  });

  it('computes max drawdown from the cumulative PnL curve regardless of input order', () => {
    // Curve: +0.1 (peak 0.1) -> -0.15 (down to -0.05, drawdown from peak 0.1 = 0.15 -> 150%) -> +0.02
    const trades = [
      trade({ id: '3', pnlSol: 0.02, executedAt: '2024-01-03T00:00:00.000Z' }),
      trade({ id: '1', pnlSol: 0.1, executedAt: '2024-01-01T00:00:00.000Z' }),
      trade({ id: '2', pnlSol: -0.15, executedAt: '2024-01-02T00:00:00.000Z' }),
    ];
    const result = computePnlAnalytics(trades);
    expect(result.maxDrawdownPercent).toBeCloseTo(150, 6);
  });

  it('reports zero drawdown for a monotonically increasing PnL curve', () => {
    const trades = [
      trade({ id: '1', pnlSol: 0.1, executedAt: '2024-01-01T00:00:00.000Z' }),
      trade({ id: '2', pnlSol: 0.1, executedAt: '2024-01-02T00:00:00.000Z' }),
    ];
    const result = computePnlAnalytics(trades);
    expect(result.maxDrawdownPercent).toBe(0);
  });
});
