import { z } from 'zod';

/**
 * Global Risk Engine configuration — the gatekeeper every trade (manual,
 * strategy-triggered, or autonomous) must pass through. Nothing bypasses it.
 */
export const RiskConfigSchema = z.object({
  userId: z.string().uuid(),
  maxPositionSizeSol: z.number().positive(),
  maxDailyLossSol: z.number().positive(),
  maxTotalExposureSol: z.number().positive(),
  maxOpenPositions: z.number().int().positive(),
  maxTradesPerDay: z.number().int().positive(),
  maxSlippageBps: z.number().int().nonnegative(),
  minSolBalance: z.number().nonnegative(),

  autonomousEnabled: z.boolean().default(false),
  autonomousMaxPositionSol: z.number().positive().nullable(),
  autonomousMaxDailyLossSol: z.number().positive().nullable(),
  autonomousMaxTrades: z.number().int().positive().nullable(),

  tradingAllocationSol: z.number().nonnegative(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const RiskRejectReasonSchema = z.enum([
  'MAX_POSITION_SIZE',
  'MAX_DAILY_LOSS',
  'MAX_TOTAL_EXPOSURE',
  'MAX_OPEN_POSITIONS',
  'MAX_TRADES_PER_DAY',
  'MAX_SLIPPAGE',
  'MIN_SOL_BALANCE',
  'TRADING_ALLOCATION_EXCEEDED',
  'KILL_SWITCH_ACTIVE',
  'AUTONOMOUS_DISABLED',
  'AUTONOMOUS_MAX_POSITION',
  'AUTONOMOUS_MAX_DAILY_LOSS',
  'AUTONOMOUS_MAX_TRADES',
  'LIVE_TRADING_DISABLED',
]);
export type RiskRejectReason = z.infer<typeof RiskRejectReasonSchema>;

export const RiskCheckResultSchema = z.object({
  approved: z.boolean(),
  reasons: z.array(RiskRejectReasonSchema),
  checkedAt: z.string().datetime(),
});
export type RiskCheckResult = z.infer<typeof RiskCheckResultSchema>;
