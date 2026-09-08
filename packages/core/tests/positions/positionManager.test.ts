import { describe, expect, it } from 'vitest';
import { computePositionPriceUpdate } from '../../src/positions/positionManager.js';
import { basePosition } from '../fixtures.js';

describe('computePositionPriceUpdate', () => {
  it('recomputes currentValueSol, unrealizedPnlSol, and unrealizedPnlPercent from the new price', () => {
    const position = basePosition({ entryPrice: 0.00001, quantity: 10_000, entryValueSol: 0.1, highestPrice: 0.00001 });
    const update = computePositionPriceUpdate(position, 0.000012); // +20%
    expect(update.currentValueSol).toBeCloseTo(0.12, 9);
    expect(update.unrealizedPnlSol).toBeCloseTo(0.02, 9);
    expect(update.unrealizedPnlPercent).toBeCloseTo(20, 6);
  });

  it('ratchets highestPrice up but never down', () => {
    const position = basePosition({ highestPrice: 0.00002 });
    const up = computePositionPriceUpdate(position, 0.00003);
    expect(up.highestPrice).toBe(0.00003);
    const down = computePositionPriceUpdate(position, 0.00001);
    expect(down.highestPrice).toBe(0.00002); // unchanged, price dipped below prior high
  });

  it('recomputes trailingStopPrice from the new highestPrice', () => {
    const position = basePosition({ highestPrice: 0.00001, trailingStopPercent: 10 });
    const update = computePositionPriceUpdate(position, 0.00002);
    expect(update.trailingStopPrice).toBeCloseTo(0.00002 * 0.9, 12);
  });

  it('leaves a FIXED stop-loss price untouched', () => {
    const position = basePosition({ stopLossMode: 'FIXED', stopLossPrice: 0.0000085 });
    const update = computePositionPriceUpdate(position, 0.00005);
    expect(update.stopLossPrice).toBe(0.0000085);
  });

  it('ratchets a DYNAMIC stop-loss price up with the new high', () => {
    const position = basePosition({ stopLossMode: 'DYNAMIC', stopLossPercent: 15, stopLossPrice: 0.0000085, highestPrice: 0.00001 });
    const update = computePositionPriceUpdate(position, 0.00002);
    expect(update.stopLossPrice).toBeCloseTo(0.00002 * 0.85, 12);
  });
});
