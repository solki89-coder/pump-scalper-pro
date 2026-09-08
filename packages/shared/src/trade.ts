import { z } from 'zod';
import { TradingModeSchema } from './position.js';

export const TradeSideSchema = z.enum(['BUY', 'SELL']);
export type TradeSide = z.infer<typeof TradeSideSchema>;

export const TradeExitReasonSchema = z.enum([
  'TAKE_PROFIT',
  'STOP_LOSS',
  'TRAILING_STOP',
  'MAX_HOLDING_TIME',
  'MANUAL',
  'SIGNAL_SELL',
  'KILL_SWITCH',
]);
export type TradeExitReason = z.infer<typeof TradeExitReasonSchema>;

export const TradeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  positionId: z.string().uuid(),
  strategyId: z.string().uuid().nullable(),
  mode: TradingModeSchema,

  mint: z.string(),
  tokenName: z.string(),
  tokenSymbol: z.string(),
  side: TradeSideSchema,

  price: z.number().positive(),
  quantity: z.number().positive(),
  sizeSol: z.number().positive(),
  feesSol: z.number().nonnegative(),
  slippageBps: z.number().int().nonnegative(),

  pnlSol: z.number().nullable(),
  pnlPercent: z.number().nullable(),
  exitReason: TradeExitReasonSchema.nullable(),
  holdingTimeSeconds: z.number().int().nonnegative().nullable(),

  entryOpportunityScore: z.number().min(0).max(100).nullable(),
  entryRiskScore: z.number().min(0).max(100).nullable(),

  txSignature: z.string().nullable(),
  executedAt: z.string().datetime(),
});
export type Trade = z.infer<typeof TradeSchema>;
