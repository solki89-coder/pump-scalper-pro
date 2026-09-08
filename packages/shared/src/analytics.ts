import { z } from 'zod';

export const PnlAnalyticsSchema = z.object({
  totalPnlSol: z.number(),
  winRate: z.number().min(0).max(100),
  lossRate: z.number().min(0).max(100),
  profitFactor: z.number().nonnegative().nullable(),
  averageWinSol: z.number().nullable(),
  averageLossSol: z.number().nullable(),
  maxDrawdownPercent: z.number().min(0).max(100),
  averageHoldingTimeSeconds: z.number().nonnegative().nullable(),
  bestTradeSol: z.number().nullable(),
  worstTradeSol: z.number().nullable(),
  totalTrades: z.number().int().nonnegative(),
  winningTrades: z.number().int().nonnegative(),
  losingTrades: z.number().int().nonnegative(),
});
export type PnlAnalytics = z.infer<typeof PnlAnalyticsSchema>;

export const TradeHistoryFilterSchema = z.enum(['TODAY', 'SEVEN_DAYS', 'THIRTY_DAYS', 'ALL']);
export type TradeHistoryFilter = z.infer<typeof TradeHistoryFilterSchema>;
