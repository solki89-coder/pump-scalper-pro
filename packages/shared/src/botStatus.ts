import { z } from 'zod';

export const BotStatusSchema = z.enum(['PAPER', 'READY', 'RUNNING', 'STOPPED', 'KILL_SWITCH']);
export type BotStatus = z.infer<typeof BotStatusSchema>;

export const BotStateSchema = z.object({
  userId: z.string().uuid(),
  status: BotStatusSchema,
  mode: z.enum(['PAPER', 'LIVE']),
  activeStrategyId: z.string().uuid().nullable(),
  killSwitchActive: z.boolean(),
  killSwitchReason: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type BotState = z.infer<typeof BotStateSchema>;

export const PortfolioSummarySchema = z.object({
  solBalance: z.number().nonnegative(),
  dailyPnlSol: z.number(),
  totalPnlSol: z.number(),
  openPositions: z.number().int().nonnegative(),
  tradesToday: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(100),
  maxDrawdownPercent: z.number().min(0).max(100),
  botStatus: BotStatusSchema,
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;
