import { computePositionPriceUpdate, evaluatePositionExit } from '@pump-scalper/core';
import type { Position } from '@pump-scalper/shared';
import { NoopTelegramAlerts, type TelegramAlertsPort } from '../telegram/alerts.js';
import type { TradingService } from './tradingService.js';

export interface PositionsUpdatePort {
  updatePosition(
    id: string,
    patch: Partial<
      Pick<
        Position,
        'currentPrice' | 'highestPrice' | 'currentValueSol' | 'unrealizedPnlSol' | 'unrealizedPnlPercent' | 'stopLossPrice' | 'trailingStopPrice'
      >
    >,
  ): Promise<Position | null>;
}

export interface MonitorLogger {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/**
 * The Position Manager's runtime loop, one tick for one open position:
 *   1. Recompute every derived field for the new price (highestPrice,
 *      PnL, stop-loss re-evaluation, trailing-stop price) and persist it —
 *      real-time updates, per spec, whether or not an exit triggers.
 *   2. Ask the pure `evaluatePositionExit` whether this tick crosses a
 *      stop-loss, trailing-stop, take-profit level, or max-holding-time.
 *   3. If it does, execute through `TradingService` — `sellPartial` for a
 *      take-profit level (so the remaining position keeps running),
 *      `closePosition` for everything else. The execution engine itself
 *      enforces slippage/balance validation before any sell goes through
 *      (see PaperExecutionEngine / SlippageExceededError) — that check
 *      runs regardless of what triggered the exit, per spec's stop-loss
 *      requirement ("Risk validation, Slippage validation, Balance
 *      validation" before selling).
 *
 * Deliberately does NOT re-run the entry-oriented Risk Engine
 * (MAX_OPEN_POSITIONS, MAX_DAILY_LOSS, etc., including KILL_SWITCH_ACTIVE)
 * before a TP/SL/trailing exit: those checks gate *opening new exposure*.
 * An exit reduces exposure — including during a kill switch, which per
 * spec stops new positions but never touches existing ones. Blocking a
 * stop-loss because the kill switch is on would leave capital undefended,
 * the opposite of what either mechanism is for.
 */
export async function monitorPositionTick(
  position: Position,
  currentPriceSol: number,
  liquiditySol: number,
  maxSlippageBps: number,
  maxHoldingTimeSeconds: number | null,
  positionsPort: PositionsUpdatePort,
  tradingService: TradingService,
  logger: MonitorLogger = console,
  alerts: TelegramAlertsPort = new NoopTelegramAlerts(),
): Promise<void> {
  if (position.status === 'CLOSED') return;

  const priceUpdate = computePositionPriceUpdate(position, currentPriceSol);
  const updated = await positionsPort.updatePosition(position.id, priceUpdate);
  const current = updated ?? { ...position, ...priceUpdate };

  const decision = evaluatePositionExit(current, {
    currentPrice: currentPriceSol,
    now: new Date(),
    maxHoldingTimeSeconds,
  });

  try {
    switch (decision.type) {
      case 'NONE':
        return;
      case 'STOP_LOSS':
      case 'TRAILING_STOP':
      case 'MAX_HOLDING_TIME': {
        const { position: closed, trade } = await tradingService.closePosition({
          positionId: current.id,
          currentPriceSol,
          liquiditySol,
          maxSlippageBps,
          reason: decision.type,
        });
        void alerts.sellExecuted(closed, trade);
        return;
      }
      case 'TAKE_PROFIT': {
        const sellQuantity = current.originalQuantity * (decision.level.sellPercent / 100);
        const { position: afterSell, trade } = await tradingService.sellPartial({
          positionId: current.id,
          quantity: sellQuantity,
          levelIndex: decision.levelIndex,
          currentPriceSol,
          liquiditySol,
          maxSlippageBps,
          reason: 'TAKE_PROFIT',
        });
        void alerts.sellExecuted(afterSell, trade);
        return;
      }
    }
  } catch (err) {
    // A single position's slippage/execution failure must never take down
    // monitoring for every other open position in the caller's loop.
    logger.error(`position ${current.id} exit (${decision.type}) failed`, err);
  }
}
