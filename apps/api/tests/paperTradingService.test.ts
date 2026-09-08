import { PaperExecutionEngine } from '@pump-scalper/core';
import type { Position, Trade } from '@pump-scalper/shared';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaperTradingService, type PositionsPort, type TradesPort } from '../src/trading/paperTradingService.js';

function fakeStores() {
  const positions = new Map<string, Position>();
  const trades: Trade[] = [];

  const positionsPort: PositionsPort = {
    async createPosition(p) {
      const position: Position = { ...p, id: randomUUID(), holdingTimeSeconds: 0 };
      positions.set(position.id, position);
      return position;
    },
    async updatePosition(id, patch) {
      const existing = positions.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      positions.set(id, updated);
      return updated;
    },
    async getPosition(id) {
      return positions.get(id) ?? null;
    },
  };

  const tradesPort: TradesPort = {
    async createTrade(t) {
      const trade: Trade = { ...t, id: randomUUID(), executedAt: new Date().toISOString() };
      trades.push(trade);
      return trade;
    },
  };

  return { positions, trades, positionsPort, tradesPort };
}

const OPEN_PARAMS = {
  userId: randomUUID(),
  strategyId: null,
  mint: 'Mint1111111111111111111111111111111111111',
  tokenName: 'Doge Killer',
  tokenSymbol: 'DOGEK',
  sizeSol: 0.5,
  currentPriceSol: 0.00001,
  liquiditySol: 10,
  maxSlippageBps: 2000,
  stopLossPercent: 15,
  stopLossMode: 'FIXED' as const,
  takeProfitLevels: [
    { triggerPercent: 10, sellPercent: 25 },
    { triggerPercent: 20, sellPercent: 25 },
  ],
  trailingStopPercent: 10,
  entryOpportunityScore: 88,
  entryRiskScore: 22,
};

describe('PaperTradingService.openPosition', () => {
  it('opens a PAPER position from a simulated fill and records a matching BUY trade', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort, trades } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position, trade } = await service.openPosition(OPEN_PARAMS);

    expect(position.mode).toBe('PAPER');
    expect(position.status).toBe('OPEN');
    expect(position.quantity).toBeGreaterThan(0);
    expect(position.entryPrice).toBeGreaterThanOrEqual(OPEN_PARAMS.currentPriceSol); // slippage makes entry >= spot
    expect(position.stopLossPrice).toBeCloseTo(position.entryPrice * 0.85, 12);
    expect(position.takeProfitLevels.every((l) => l.executed === false)).toBe(true);

    expect(trade.side).toBe('BUY');
    expect(trade.txSignature).toBeNull();
    expect(trade.quantity).toBe(position.quantity);
    expect(trades).toHaveLength(1);
  });

  it('never sends a transaction signature, per PAPER mode rules', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);
    const { trade } = await service.openPosition(OPEN_PARAMS);
    expect(trade.txSignature).toBeNull();
  });
});

describe('PaperTradingService.closePosition', () => {
  it('closes an open position, records realized PnL, and appends a SELL trade', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort, trades } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position: opened } = await service.openPosition(OPEN_PARAMS);
    const { position: closed, trade: sellTrade } = await service.closePosition({
      positionId: opened.id,
      currentPriceSol: OPEN_PARAMS.currentPriceSol * 1.3, // priced up 30% for a winning close
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    expect(closed.realizedPnlSol).toBeGreaterThan(0); // priced up, minus fees/slippage, should still net positive
    expect(sellTrade.side).toBe('SELL');
    expect(sellTrade.exitReason).toBe('TAKE_PROFIT');
    expect(sellTrade.pnlSol).toBe(closed.realizedPnlSol);
    expect(sellTrade.holdingTimeSeconds).toBeGreaterThanOrEqual(0);
    expect(trades).toHaveLength(2); // BUY + SELL
  });

  it('rejects closing an already-closed position', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position } = await service.openPosition(OPEN_PARAMS);
    await service.closePosition({
      positionId: position.id,
      currentPriceSol: OPEN_PARAMS.currentPriceSol,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'MANUAL',
    });

    await expect(
      service.closePosition({
        positionId: position.id,
        currentPriceSol: OPEN_PARAMS.currentPriceSol,
        liquiditySol: 10,
        maxSlippageBps: 2000,
        reason: 'MANUAL',
      }),
    ).rejects.toThrow('already closed');
  });

  it('rejects closing a position that does not exist', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);
    await expect(
      service.closePosition({
        positionId: 'nonexistent',
        currentPriceSol: 1,
        liquiditySol: 10,
        maxSlippageBps: 2000,
        reason: 'MANUAL',
      }),
    ).rejects.toThrow('not found');
  });

  it('reports a loss when price drops before close', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position } = await service.openPosition(OPEN_PARAMS);
    const { position: closed, trade } = await service.closePosition({
      positionId: position.id,
      currentPriceSol: OPEN_PARAMS.currentPriceSol * 0.8, // priced down 20%
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'STOP_LOSS',
    });

    expect(closed.realizedPnlSol).toBeLessThan(0);
    expect(trade.pnlPercent).toBeLessThan(0);
  });
});

describe('PaperTradingService.sellPartial', () => {
  it('sells only the requested quantity, leaves the position OPEN with the remainder, and marks the TP level executed', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort, trades } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position: opened } = await service.openPosition({
      ...OPEN_PARAMS,
      takeProfitLevels: [
        { triggerPercent: 10, sellPercent: 25 },
        { triggerPercent: 20, sellPercent: 25 },
      ],
    });
    const sellQty = opened.originalQuantity * 0.25;

    const { position: after, trade } = await service.sellPartial({
      positionId: opened.id,
      quantity: sellQty,
      levelIndex: 0,
      currentPriceSol: OPEN_PARAMS.currentPriceSol * 1.1,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });

    expect(after.status).toBe('OPEN');
    expect(after.quantity).toBeCloseTo(opened.quantity - sellQty, 6);
    expect(after.takeProfitLevels[0]?.executed).toBe(true);
    expect(after.takeProfitLevels[1]?.executed).toBe(false);
    expect(trade.side).toBe('SELL');
    expect(trade.quantity).toBeCloseTo(sellQty, 6);
    expect(trades).toHaveLength(2); // BUY + partial SELL
  });

  it('accumulates realizedPnlSol across multiple partial sells', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position: opened } = await service.openPosition(OPEN_PARAMS);
    const sellQty = opened.originalQuantity * 0.25;

    const { position: afterFirst } = await service.sellPartial({
      positionId: opened.id,
      quantity: sellQty,
      levelIndex: 0,
      currentPriceSol: OPEN_PARAMS.currentPriceSol * 1.1,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });
    const { position: afterSecond } = await service.sellPartial({
      positionId: opened.id,
      quantity: sellQty,
      levelIndex: 1,
      currentPriceSol: OPEN_PARAMS.currentPriceSol * 1.2,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });

    expect(afterSecond.realizedPnlSol).toBeGreaterThan(afterFirst.realizedPnlSol);
  });

  it('closes the position outright once a partial sell exhausts the remaining quantity', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position: opened } = await service.openPosition(OPEN_PARAMS);
    const { position: after } = await service.sellPartial({
      positionId: opened.id,
      quantity: opened.quantity, // the entire remaining amount
      levelIndex: null,
      currentPriceSol: OPEN_PARAMS.currentPriceSol,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });

    expect(after.status).toBe('CLOSED');
    expect(after.quantity).toBe(0);
    expect(after.closedAt).not.toBeNull();
  });

  it('caps the sell at the remaining quantity rather than overselling', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position: opened } = await service.openPosition(OPEN_PARAMS);
    const { trade } = await service.sellPartial({
      positionId: opened.id,
      quantity: opened.quantity * 10, // absurdly oversized request
      levelIndex: null,
      currentPriceSol: OPEN_PARAMS.currentPriceSol,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'TAKE_PROFIT',
    });

    expect(trade.quantity).toBeCloseTo(opened.quantity, 6);
  });

  it('rejects a partial sell on an already-closed position', async () => {
    const engine = new PaperExecutionEngine();
    const { positionsPort, tradesPort } = fakeStores();
    const service = new PaperTradingService(engine, positionsPort, tradesPort);

    const { position: opened } = await service.openPosition(OPEN_PARAMS);
    await service.closePosition({
      positionId: opened.id,
      currentPriceSol: OPEN_PARAMS.currentPriceSol,
      liquiditySol: 10,
      maxSlippageBps: 2000,
      reason: 'MANUAL',
    });

    await expect(
      service.sellPartial({
        positionId: opened.id,
        quantity: 1,
        levelIndex: 0,
        currentPriceSol: OPEN_PARAMS.currentPriceSol,
        liquiditySol: 10,
        maxSlippageBps: 2000,
        reason: 'TAKE_PROFIT',
      }),
    ).rejects.toThrow('already closed');
  });
});
