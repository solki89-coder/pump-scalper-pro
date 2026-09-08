import type { Position, Trade } from '@pump-scalper/shared';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { monitorPositionTick, type PositionsUpdatePort } from '../src/trading/positionMonitor.js';
import type { TradingService } from '../src/trading/tradingService.js';

function basePosition(overrides: Partial<Position> = {}): Position {
  const entryPrice = 0.00001;
  return {
    id: randomUUID(),
    userId: 'user1',
    strategyId: null,
    mode: 'PAPER',
    status: 'OPEN',
    mint: 'Mint1',
    tokenName: 'Doge Killer',
    tokenSymbol: 'DOGEK',
    entryPrice,
    currentPrice: entryPrice,
    highestPrice: entryPrice,
    quantity: 1_000_000,
    originalQuantity: 1_000_000,
    entryValueSol: 0.1,
    currentValueSol: 0.1,
    unrealizedPnlSol: 0,
    unrealizedPnlPercent: 0,
    realizedPnlSol: 0,
    stopLossPercent: 15,
    stopLossPrice: entryPrice * 0.85,
    stopLossMode: 'FIXED',
    takeProfitLevels: [{ triggerPercent: 10, sellPercent: 25, executed: false, executedAt: null }],
    trailingStopPercent: null,
    trailingStopPrice: null,
    entryOpportunityScore: 88,
    entryRiskScore: 20,
    entryTime: new Date().toISOString(),
    closedAt: null,
    holdingTimeSeconds: 0,
    ...overrides,
  };
}

function fakePositionsPort(position: Position): PositionsUpdatePort & { lastPatch: unknown } {
  return {
    lastPatch: null,
    async updatePosition(_id, patch) {
      (this as { lastPatch: unknown }).lastPatch = patch;
      return { ...position, ...patch };
    },
  };
}

function fakeTradingService(): TradingService & { closed: unknown[]; sold: unknown[] } {
  return {
    closed: [],
    sold: [],
    async openPosition() {
      throw new Error('not used in these tests');
    },
    async closePosition(params) {
      (this as { closed: unknown[] }).closed.push(params);
      return { position: {} as Position, trade: {} as Trade };
    },
    async sellPartial(params) {
      (this as { sold: unknown[] }).sold.push(params);
      return { position: {} as Position, trade: {} as Trade };
    },
  };
}

describe('monitorPositionTick', () => {
  it('does nothing on an already-closed position', async () => {
    const position = basePosition({ status: 'CLOSED' });
    const positionsPort = fakePositionsPort(position);
    const trading = fakeTradingService();
    await monitorPositionTick(position, 0.000005, 10, 2000, null, positionsPort, trading);
    expect(trading.closed).toHaveLength(0);
    expect(trading.sold).toHaveLength(0);
  });

  it('persists the price update every tick, even when nothing triggers', async () => {
    const position = basePosition();
    const positionsPort = fakePositionsPort(position);
    const trading = fakeTradingService();
    await monitorPositionTick(position, 0.0000105, 10, 2000, null, positionsPort, trading);
    expect(positionsPort.lastPatch).toBeTruthy();
    expect(trading.closed).toHaveLength(0);
    expect(trading.sold).toHaveLength(0);
  });

  it('closes the position with reason STOP_LOSS when price drops to the stop', async () => {
    const position = basePosition();
    const positionsPort = fakePositionsPort(position);
    const trading = fakeTradingService();
    await monitorPositionTick(position, 0.0000084, 10, 2000, null, positionsPort, trading); // below 0.0000085 stop
    expect(trading.closed).toEqual([expect.objectContaining({ reason: 'STOP_LOSS' })]);
  });

  it('closes the position with reason TRAILING_STOP once armed and pulled back', async () => {
    const position = basePosition({ highestPrice: 0.00002, trailingStopPercent: 10, stopLossPrice: 0.0000001 });
    const positionsPort = fakePositionsPort(position);
    const trading = fakeTradingService();
    await monitorPositionTick(position, 0.0000179, 10, 2000, null, positionsPort, trading); // below 0.000018 trailing stop
    expect(trading.closed).toEqual([expect.objectContaining({ reason: 'TRAILING_STOP' })]);
  });

  it('sells the correct quantity (sellPercent of originalQuantity) when a take-profit level triggers', async () => {
    const position = basePosition({ stopLossPrice: 0.0000001 });
    const positionsPort = fakePositionsPort(position);
    const trading = fakeTradingService();
    await monitorPositionTick(position, 0.0000115, 10, 2000, null, positionsPort, trading); // +15%, past TP1 (+10%)
    expect(trading.sold).toHaveLength(1);
    const sold = trading.sold[0] as { quantity: number; levelIndex: number; reason: string };
    expect(sold.quantity).toBeCloseTo(250_000, 3); // 25% of 1,000,000
    expect(sold.levelIndex).toBe(0);
    expect(sold.reason).toBe('TAKE_PROFIT');
  });

  it('closes with MAX_HOLDING_TIME once the cap is exceeded, independent of price', async () => {
    const entryTime = new Date(Date.now() - 700_000).toISOString();
    const position = basePosition({ entryTime, stopLossPrice: 0.0000001, takeProfitLevels: [] });
    const positionsPort = fakePositionsPort(position);
    const trading = fakeTradingService();
    await monitorPositionTick(position, position.entryPrice, 10, 2000, 600, positionsPort, trading);
    expect(trading.closed).toEqual([expect.objectContaining({ reason: 'MAX_HOLDING_TIME' })]);
  });

  it('logs and swallows an execution failure instead of throwing, so other positions keep monitoring', async () => {
    const position = basePosition();
    const positionsPort = fakePositionsPort(position);
    const trading: TradingService = {
      async openPosition() {
        throw new Error('unused');
      },
      async closePosition() {
        throw new Error('slippage exceeded');
      },
      async sellPartial() {
        throw new Error('unused');
      },
    };
    const errors: unknown[] = [];
    await expect(
      monitorPositionTick(position, 0.0000084, 10, 2000, null, positionsPort, trading, {
        info: () => {},
        error: (_, err) => errors.push(err),
      }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
