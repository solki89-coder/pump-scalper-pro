import type { Position, TakeProfitLevelState } from '@pump-scalper/shared';

/**
 * Recomputes the stop-loss price for the *current* tick.
 *   - FIXED: locked at entry, never moves — what `position.stopLossPrice`
 *     already is. Returned unchanged.
 *   - DYNAMIC: ratchets up as the position's highest price increases (using
 *     the same `stopLossPercent` distance, applied to the new high instead
 *     of the entry price), and never moves down. This is this project's
 *     documented interpretation of "dynamic" stop loss — the spec names the
 *     FIXED/DYNAMIC modes but doesn't define DYNAMIC's exact formula; this
 *     is a defensible one (locks in gains, never re-loosens), not a claimed
 *     industry-standard formula.
 */
export function recalculateStopLossPrice(position: Pick<Position, 'entryPrice' | 'highestPrice' | 'stopLossPercent' | 'stopLossPrice' | 'stopLossMode'>, currentPrice: number): number {
  if (position.stopLossMode === 'FIXED') return position.stopLossPrice;
  const highest = Math.max(position.highestPrice, currentPrice);
  const dynamicPrice = highest * (1 - position.stopLossPercent / 100);
  return Math.max(position.stopLossPrice, dynamicPrice);
}

/** highestPrice - trailingPercentage, per spec. Null if the position has no trailing stop configured. */
export function computeTrailingStopPrice(highestPrice: number, trailingStopPercent: number | null): number | null {
  if (trailingStopPercent === null) return null;
  return highestPrice * (1 - trailingStopPercent / 100);
}

export type ExitDecision =
  | { type: 'NONE' }
  | { type: 'STOP_LOSS'; triggerPrice: number }
  | { type: 'TRAILING_STOP'; triggerPrice: number }
  | { type: 'TAKE_PROFIT'; level: TakeProfitLevelState; levelIndex: number; triggerPrice: number }
  | { type: 'MAX_HOLDING_TIME'; holdingTimeSeconds: number };

export interface ExitEvaluationContext {
  currentPrice: number;
  now: Date;
  maxHoldingTimeSeconds: number | null;
}

/**
 * The single decision function the Position Manager calls on every price
 * update. Priority order (checked top to bottom, first match wins):
 *   1. STOP_LOSS — capital protection comes first, always.
 *   2. TRAILING_STOP — once armed (a highestPrice above entry exists),
 *      protects accumulated gains ahead of taking a fresh partial profit.
 *   3. TAKE_PROFIT — the lowest-index unexecuted level whose trigger price
 *      has been reached. Only one level is returned per call by design: a
 *      price spike that jumps two levels at once still triggers them in
 *      order, one per subsequent evaluation, rather than dumping the whole
 *      remaining position on a single tick.
 *   4. MAX_HOLDING_TIME — the catch-all: exit if the position has simply
 *      been open too long, independent of price.
 * This function is pure and has no side effects — it's the caller's job to
 * actually sell (PaperTradingService / the live engine) and to persist the
 * result; every trigger still passes through the Risk Engine like any
 * other sell (slippage/balance validation), per spec.
 */
export function evaluatePositionExit(position: Position, ctx: ExitEvaluationContext): ExitDecision {
  const stopLossPrice = recalculateStopLossPrice(position, ctx.currentPrice);
  if (ctx.currentPrice <= stopLossPrice) {
    return { type: 'STOP_LOSS', triggerPrice: stopLossPrice };
  }

  const trailingStopPrice = computeTrailingStopPrice(position.highestPrice, position.trailingStopPercent);
  if (trailingStopPrice !== null && ctx.currentPrice <= trailingStopPrice && position.highestPrice > position.entryPrice) {
    return { type: 'TRAILING_STOP', triggerPrice: trailingStopPrice };
  }

  for (let i = 0; i < position.takeProfitLevels.length; i++) {
    const level = position.takeProfitLevels[i]!;
    if (level.executed) continue;
    const triggerPrice = position.entryPrice * (1 + level.triggerPercent / 100);
    if (ctx.currentPrice >= triggerPrice) {
      return { type: 'TAKE_PROFIT', level, levelIndex: i, triggerPrice };
    }
    break; // levels are evaluated in order; a later level can't fire before an earlier one
  }

  if (ctx.maxHoldingTimeSeconds !== null) {
    const holdingTimeSeconds = Math.max(0, (ctx.now.getTime() - new Date(position.entryTime).getTime()) / 1000);
    if (holdingTimeSeconds >= ctx.maxHoldingTimeSeconds) {
      return { type: 'MAX_HOLDING_TIME', holdingTimeSeconds };
    }
  }

  return { type: 'NONE' };
}
