import type { PnlAnalytics, Position, RiskCheckResult, Trade } from '@pump-scalper/shared';
import { describe, expect, it } from 'vitest';
import * as fmt from '../src/telegram/formatting.js';

const basePosition: Position = {
  id: 'p1',
  userId: 'u1',
  strategyId: null,
  mode: 'PAPER',
  status: 'OPEN',
  mint: 'Mint1',
  tokenName: 'Doge Killer',
  tokenSymbol: 'DOGEK',
  entryPrice: 0.00001,
  currentPrice: 0.000012,
  highestPrice: 0.000012,
  quantity: 1_000_000,
  originalQuantity: 1_000_000,
  entryValueSol: 0.1,
  currentValueSol: 0.12,
  unrealizedPnlSol: 0.02,
  unrealizedPnlPercent: 20,
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
  holdingTimeSeconds: 120,
};

describe('formatBuyExecuted', () => {
  it('includes TOKEN, ENTRY, SIZE, SL, TP, SCORE, RISK per spec', () => {
    const msg = fmt.formatBuyExecuted(basePosition);
    expect(msg).toContain('DOGEK');
    expect(msg).toContain('SL');
    expect(msg).toContain('15%');
    expect(msg).toContain('TP');
    expect(msg).toContain('+10%/25%');
    expect(msg).toContain('88');
    expect(msg).toContain('20');
  });
});

describe('formatSellExecuted', () => {
  it('includes TOKEN, ENTRY, EXIT, PNL, HOLD TIME, REASON per spec', () => {
    const trade: Trade = {
      id: 't1',
      userId: 'u1',
      positionId: 'p1',
      strategyId: null,
      mode: 'PAPER',
      mint: 'Mint1',
      tokenName: 'Doge Killer',
      tokenSymbol: 'DOGEK',
      side: 'SELL',
      price: 0.000013,
      quantity: 1_000_000,
      sizeSol: 0.13,
      feesSol: 0.001,
      slippageBps: 100,
      pnlSol: 0.03,
      pnlPercent: 30,
      exitReason: 'TAKE_PROFIT',
      holdingTimeSeconds: 300,
      entryOpportunityScore: 88,
      entryRiskScore: 20,
      txSignature: null,
      executedAt: new Date().toISOString(),
    };
    const msg = fmt.formatSellExecuted(basePosition, trade);
    expect(msg).toContain('DOGEK');
    expect(msg).toContain('Exit');
    expect(msg).toContain('+0.0300 SOL');
    expect(msg).toContain('5.0 min');
    expect(msg).toContain('TAKE_PROFIT');
  });
});

describe('formatPnl', () => {
  it('renders the key analytics fields', () => {
    const analytics: PnlAnalytics = {
      totalPnlSol: 0.5,
      winRate: 60,
      lossRate: 40,
      profitFactor: 2.1,
      averageWinSol: 0.1,
      averageLossSol: -0.05,
      maxDrawdownPercent: 12.5,
      averageHoldingTimeSeconds: 300,
      bestTradeSol: 0.3,
      worstTradeSol: -0.1,
      totalTrades: 10,
      winningTrades: 6,
      losingTrades: 4,
    };
    const msg = fmt.formatPnl(analytics);
    expect(msg).toContain('60.0% (6/10)');
    expect(msg).toContain('2.10');
    expect(msg).toContain('12.5%');
  });

  it('renders n/a for a null profit factor rather than crashing', () => {
    const analytics: PnlAnalytics = {
      totalPnlSol: 0,
      winRate: 0,
      lossRate: 0,
      profitFactor: null,
      averageWinSol: null,
      averageLossSol: null,
      maxDrawdownPercent: 0,
      averageHoldingTimeSeconds: null,
      bestTradeSol: null,
      worstTradeSol: null,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
    };
    expect(fmt.formatPnl(analytics)).toContain('n/a');
  });
});

describe('formatPositions', () => {
  it('reports no open positions when the list is empty', () => {
    expect(fmt.formatPositions([])).toBe('No open positions.');
  });

  it('lists each position with its unrealized PnL', () => {
    const msg = fmt.formatPositions([basePosition]);
    expect(msg).toContain('DOGEK');
    expect(msg).toContain('+0.0200 SOL');
  });
});

describe('formatRiskReject', () => {
  it('lists every rejection reason', () => {
    const result: RiskCheckResult = { approved: false, reasons: ['MAX_OPEN_POSITIONS', 'MAX_SLIPPAGE'], checkedAt: new Date().toISOString() };
    const msg = fmt.formatRiskReject('Mint1', 0.1, result);
    expect(msg).toContain('MAX_OPEN_POSITIONS');
    expect(msg).toContain('MAX_SLIPPAGE');
  });
});

describe('formatKillSwitch', () => {
  it('differentiates activation and deactivation', () => {
    expect(fmt.formatKillSwitch(true, 'manual')).toContain('activated');
    expect(fmt.formatKillSwitch(false, null)).toContain('deactivated');
  });
});
