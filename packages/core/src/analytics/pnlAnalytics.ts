import type { PnlAnalytics, Trade } from '@pump-scalper/shared';

/**
 * All figures computed only from CLOSED trades (side === 'SELL', which is
 * how a trade records its realized pnlSol/pnlPercent/holdingTimeSeconds —
 * see trade.ts). Pure — no DB access; the caller fetches the trade list.
 */
export function computePnlAnalytics(trades: Trade[]): PnlAnalytics {
  const closed = trades.filter((t) => t.side === 'SELL' && t.pnlSol !== null);

  const totalPnlSol = closed.reduce((sum, t) => sum + (t.pnlSol ?? 0), 0);
  const winners = closed.filter((t) => (t.pnlSol ?? 0) > 0);
  const losers = closed.filter((t) => (t.pnlSol ?? 0) < 0);

  const totalTrades = closed.length;
  const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
  const lossRate = totalTrades > 0 ? (losers.length / totalTrades) * 100 : 0;

  const grossProfit = winners.reduce((sum, t) => sum + (t.pnlSol ?? 0), 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + (t.pnlSol ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : winners.length > 0 ? null : null;

  const averageWinSol = winners.length > 0 ? grossProfit / winners.length : null;
  const averageLossSol = losers.length > 0 ? -grossLoss / losers.length : null;

  const holdingTimes = closed.map((t) => t.holdingTimeSeconds).filter((h): h is number => h !== null);
  const averageHoldingTimeSeconds =
    holdingTimes.length > 0 ? holdingTimes.reduce((sum, h) => sum + h, 0) / holdingTimes.length : null;

  const pnlValues = closed.map((t) => t.pnlSol ?? 0);
  const bestTradeSol = pnlValues.length > 0 ? Math.max(...pnlValues) : null;
  const worstTradeSol = pnlValues.length > 0 ? Math.min(...pnlValues) : null;

  const maxDrawdownPercent = computeMaxDrawdownPercent(closed);

  return {
    totalPnlSol,
    winRate,
    lossRate,
    profitFactor,
    averageWinSol,
    averageLossSol,
    maxDrawdownPercent,
    averageHoldingTimeSeconds,
    bestTradeSol,
    worstTradeSol,
    totalTrades,
    winningTrades: winners.length,
    losingTrades: losers.length,
  };
}

/**
 * Max peak-to-trough drawdown of the cumulative realized-PnL curve, as a
 * percentage of the running peak. Trades are walked in execution order
 * (oldest first) — callers typically fetch newest-first, so this sorts
 * defensively rather than trusting caller order.
 */
function computeMaxDrawdownPercent(closedTrades: Trade[]): number {
  const ordered = [...closedTrades].sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;

  for (const trade of ordered) {
    cumulative += trade.pnlSol ?? 0;
    peak = Math.max(peak, cumulative);
    if (peak > 0) {
      const drawdownPercent = ((peak - cumulative) / peak) * 100;
      maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
    }
  }
  return maxDrawdownPercent;
}
