import { describe, expect, it } from 'vitest';
import {
  computeTrailingStopPrice,
  evaluatePositionExit,
  recalculateStopLossPrice,
} from '../../src/positions/positionEvaluator.js';
import { basePosition } from '../fixtures.js';

describe('recalculateStopLossPrice', () => {
  it('FIXED mode never moves, regardless of price', () => {
    const position = basePosition({ stopLossMode: 'FIXED', stopLossPrice: 0.0000085 });
    expect(recalculateStopLossPrice(position, 0.00003)).toBe(0.0000085);
  });

  it('DYNAMIC mode ratchets up with the highest price reached', () => {
    const position = basePosition({ stopLossMode: 'DYNAMIC', stopLossPercent: 15, stopLossPrice: 0.0000085, highestPrice: 0.00001 });
    const result = recalculateStopLossPrice(position, 0.00002); // new high
    expect(result).toBeCloseTo(0.00002 * 0.85, 12);
  });

  it('DYNAMIC mode never moves the stop back down', () => {
    const position = basePosition({ stopLossMode: 'DYNAMIC', stopLossPercent: 15, stopLossPrice: 0.000017, highestPrice: 0.00002 });
    // price dips well below the prior high, but stop must not loosen
    const result = recalculateStopLossPrice(position, 0.0000105);
    expect(result).toBe(0.000017);
  });
});

describe('computeTrailingStopPrice', () => {
  it('is highestPrice - trailingPercentage', () => {
    expect(computeTrailingStopPrice(0.0001, 10)).toBeCloseTo(0.00009, 12);
  });

  it('is null when no trailing stop is configured', () => {
    expect(computeTrailingStopPrice(0.0001, null)).toBeNull();
  });
});

describe('evaluatePositionExit', () => {
  const ctx = (currentPrice: number, maxHoldingTimeSeconds: number | null = null) => ({
    currentPrice,
    now: new Date(),
    maxHoldingTimeSeconds,
  });

  it('returns NONE when nothing has triggered', () => {
    const position = basePosition();
    const decision = evaluatePositionExit(position, ctx(position.entryPrice));
    expect(decision.type).toBe('NONE');
  });

  it('triggers STOP_LOSS when price falls to or below the stop-loss price', () => {
    const position = basePosition({ stopLossPrice: 0.0000085 });
    const decision = evaluatePositionExit(position, ctx(0.0000084));
    expect(decision.type).toBe('STOP_LOSS');
  });

  it('STOP_LOSS takes priority even if a take-profit level would otherwise fire', () => {
    // Contrived: stop-loss set above entry (e.g. after a DYNAMIC ratchet) while a TP level is also in range.
    const position = basePosition({
      stopLossMode: 'FIXED',
      stopLossPrice: 0.000012, // above entry, simulating an already-ratcheted stop
      entryPrice: 0.00001,
      takeProfitLevels: [{ triggerPercent: 10, sellPercent: 25, executed: false, executedAt: null }],
    });
    const decision = evaluatePositionExit(position, ctx(0.0000115)); // above TP1 trigger (0.000011) but below stop
    expect(decision.type).toBe('STOP_LOSS');
  });

  it('triggers TRAILING_STOP once the position has moved up and then pulled back past the trailing distance', () => {
    const position = basePosition({
      entryPrice: 0.00001,
      highestPrice: 0.00002, // ran up 100%
      trailingStopPercent: 10,
      stopLossPrice: 0.0000001, // far below, so it never fires first
    });
    const decision = evaluatePositionExit(position, ctx(0.000018)); // trailing stop = 0.000018 exactly
    expect(decision.type).toBe('TRAILING_STOP');
  });

  it('does not arm the trailing stop before the position has ever moved above entry', () => {
    const position = basePosition({
      entryPrice: 0.00001,
      highestPrice: 0.00001, // never moved
      trailingStopPercent: 10,
      stopLossPrice: 0.0000001,
    });
    const decision = evaluatePositionExit(position, ctx(0.0000095)); // below the trailing calc, but never armed
    expect(decision.type).toBe('NONE');
  });

  it('triggers TAKE_PROFIT for the lowest-index unexecuted level whose price is reached', () => {
    const position = basePosition({ entryPrice: 0.00001, stopLossPrice: 0.0000001, trailingStopPercent: null });
    const decision = evaluatePositionExit(position, ctx(0.0000115)); // +15%, past TP1 (+10%) but not TP2 (+20%)
    expect(decision.type).toBe('TAKE_PROFIT');
    if (decision.type === 'TAKE_PROFIT') {
      expect(decision.levelIndex).toBe(0);
    }
  });

  it('does not re-trigger an already-executed take-profit level', () => {
    const position = basePosition({
      entryPrice: 0.00001,
      stopLossPrice: 0.0000001,
      trailingStopPercent: null,
      takeProfitLevels: [
        { triggerPercent: 10, sellPercent: 25, executed: true, executedAt: new Date().toISOString() },
        { triggerPercent: 20, sellPercent: 25, executed: false, executedAt: null },
      ],
    });
    const decision = evaluatePositionExit(position, ctx(0.0000115)); // past TP1 (10%) again but it's done; not yet past TP2 (20%)
    expect(decision.type).toBe('NONE');
  });

  it('moves to the next level once an earlier one is executed', () => {
    const position = basePosition({
      entryPrice: 0.00001,
      stopLossPrice: 0.0000001,
      trailingStopPercent: null,
      takeProfitLevels: [
        { triggerPercent: 10, sellPercent: 25, executed: true, executedAt: new Date().toISOString() },
        { triggerPercent: 20, sellPercent: 25, executed: false, executedAt: null },
      ],
    });
    const decision = evaluatePositionExit(position, ctx(0.0000125)); // above TP2's 0.000012
    expect(decision.type).toBe('TAKE_PROFIT');
    if (decision.type === 'TAKE_PROFIT') expect(decision.levelIndex).toBe(1);
  });

  it('triggers MAX_HOLDING_TIME once the position has been open long enough, independent of price', () => {
    const entryTime = new Date(Date.now() - 700_000).toISOString(); // ~11.6 minutes ago
    const position = basePosition({
      entryTime,
      stopLossPrice: 0.0000001,
      trailingStopPercent: null,
      takeProfitLevels: [],
    });
    const decision = evaluatePositionExit(position, ctx(position.entryPrice, 600)); // cap 600s
    expect(decision.type).toBe('MAX_HOLDING_TIME');
  });

  it('does not check MAX_HOLDING_TIME when no cap is configured', () => {
    const entryTime = new Date(Date.now() - 10_000_000).toISOString();
    const position = basePosition({ entryTime, stopLossPrice: 0.0000001, trailingStopPercent: null, takeProfitLevels: [] });
    const decision = evaluatePositionExit(position, ctx(position.entryPrice, null));
    expect(decision.type).toBe('NONE');
  });
});
