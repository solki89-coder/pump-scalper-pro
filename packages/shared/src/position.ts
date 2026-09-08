import { z } from 'zod';
import { StopLossModeSchema, TakeProfitLevelSchema } from './strategy.js';

export const TradingModeSchema = z.enum(['PAPER', 'LIVE']);
export type TradingMode = z.infer<typeof TradingModeSchema>;

export const PositionStatusSchema = z.enum(['OPEN', 'CLOSED']);
export type PositionStatus = z.infer<typeof PositionStatusSchema>;

export const TakeProfitLevelStateSchema = TakeProfitLevelSchema.extend({
  executed: z.boolean().default(false),
  executedAt: z.string().datetime().nullable().default(null),
});
export type TakeProfitLevelState = z.infer<typeof TakeProfitLevelStateSchema>;

export const PositionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  strategyId: z.string().uuid().nullable(),
  mode: TradingModeSchema,
  status: PositionStatusSchema,

  mint: z.string(),
  tokenName: z.string(),
  tokenSymbol: z.string(),

  entryPrice: z.number().positive(),
  currentPrice: z.number().nonnegative(),
  highestPrice: z.number().nonnegative(),
  /** Remaining, unsold quantity — reduced by each partial take-profit sell. */
  quantity: z.number().nonnegative(),
  /** The full quantity bought at entry, fixed for the position's lifetime. Take-profit sellPercent values are always relative to this, never to the shrinking `quantity`. */
  originalQuantity: z.number().positive(),

  entryValueSol: z.number().positive(),
  currentValueSol: z.number().nonnegative(),
  unrealizedPnlSol: z.number(),
  unrealizedPnlPercent: z.number(),
  realizedPnlSol: z.number().default(0),

  stopLossPercent: z.number().positive(),
  stopLossPrice: z.number().positive(),
  stopLossMode: StopLossModeSchema,
  takeProfitLevels: z.array(TakeProfitLevelStateSchema),
  trailingStopPercent: z.number().positive().nullable(),
  trailingStopPrice: z.number().positive().nullable(),

  entryOpportunityScore: z.number().min(0).max(100).nullable(),
  entryRiskScore: z.number().min(0).max(100).nullable(),

  entryTime: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  holdingTimeSeconds: z.number().int().nonnegative(),
});
export type Position = z.infer<typeof PositionSchema>;
