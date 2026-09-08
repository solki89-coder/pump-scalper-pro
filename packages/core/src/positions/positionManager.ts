import type { Position } from '@pump-scalper/shared';
import { computeTrailingStopPrice, recalculateStopLossPrice } from './positionEvaluator.js';

export interface PositionPriceUpdate {
  currentPrice: number;
  highestPrice: number;
  currentValueSol: number;
  unrealizedPnlSol: number;
  unrealizedPnlPercent: number;
  stopLossPrice: number;
  trailingStopPrice: number | null;
}

/**
 * The Position Manager's real-time update step: given a position and a
 * fresh price tick, recomputes every derived field (spec: "עדכון בזמן
 * אמת" — highestPrice ratchets, PnL, stop-loss re-evaluation for DYNAMIC
 * mode, trailing-stop price). Pure — returns the patch to persist; it does
 * not write to the database itself (apps/api's position update loop does
 * that, and separately calls evaluatePositionExit to decide on a sell).
 */
export function computePositionPriceUpdate(position: Position, currentPrice: number): PositionPriceUpdate {
  const highestPrice = Math.max(position.highestPrice, currentPrice);
  const currentValueSol = position.quantity * currentPrice;
  const unrealizedPnlSol = currentValueSol - position.entryValueSol;
  const unrealizedPnlPercent = position.entryValueSol > 0 ? (unrealizedPnlSol / position.entryValueSol) * 100 : 0;

  const stopLossPrice = recalculateStopLossPrice(
    { ...position, highestPrice },
    currentPrice,
  );
  const trailingStopPrice = computeTrailingStopPrice(highestPrice, position.trailingStopPercent);

  return {
    currentPrice,
    highestPrice,
    currentValueSol,
    unrealizedPnlSol,
    unrealizedPnlPercent,
    stopLossPrice,
    trailingStopPrice,
  };
}
