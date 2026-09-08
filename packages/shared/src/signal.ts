import { z } from 'zod';

export const SignalTypeSchema = z.enum(['STRONG_BUY', 'BUY', 'WATCH', 'WAIT', 'REJECT', 'SELL']);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SignalSchema = z.object({
  id: z.string().uuid().optional(),
  mint: z.string(),
  strategyId: z.string().uuid().nullable(),
  signal: SignalTypeSchema,
  reason: z.string(),
  scores: z
    .object({
      opportunityScore: z.number(),
      riskScore: z.number(),
      momentumScore: z.number(),
      liquidityScore: z.number(),
      buyPressureScore: z.number(),
    })
    .partial(),
  createdAt: z.string().datetime().optional(),
});
export type Signal = z.infer<typeof SignalSchema>;
