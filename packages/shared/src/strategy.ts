import { z } from 'zod';
import { ScoreWeightsSchema, DEFAULT_SCORE_WEIGHTS } from './scoring.js';

export const TakeProfitLevelSchema = z.object({
  triggerPercent: z.number().positive(),
  sellPercent: z.number().positive().max(100),
});
export type TakeProfitLevel = z.infer<typeof TakeProfitLevelSchema>;

export const StopLossModeSchema = z.enum(['FIXED', 'DYNAMIC']);
export type StopLossMode = z.infer<typeof StopLossModeSchema>;

const MinMax = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
});

function validateTakeProfitLevels(cfg: { takeProfitLevels: TakeProfitLevel[] }, ctx: z.RefinementCtx): void {
  const total = cfg.takeProfitLevels.reduce((sum, l) => sum + l.sellPercent, 0);
  if (total > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `takeProfitLevels sellPercent sums to ${total}%, must be <= 100%`,
      path: ['takeProfitLevels'],
    });
  }
}

/** The base object shape, without the cross-field take-profit refinement — usable with `.omit()`/`.pick()` (ZodEffects from `.superRefine()` below isn't). */
export const StrategyConfigObjectSchema = z.object({
    id: z.string().uuid().optional(),
    userId: z.string().uuid(),
    name: z.string().min(1).max(100),
    enabled: z.boolean().default(false),
    autonomous: z.boolean().default(false),

    // Discovery filters
    tokenAgeSeconds: MinMax,
    liquiditySol: MinMax,
    volumeSolMin: z.number().nonnegative().nullable(),
    marketCapSol: MinMax,
    buySellRatioMin: z.number().nonnegative().nullable(),
    uniqueBuyersMin: z.number().int().nonnegative().nullable(),
    holderConcentrationPercentMax: z.number().min(0).max(100).nullable(),
    creatorHoldingPercentMax: z.number().min(0).max(100).nullable(),

    // Scoring thresholds
    opportunityScoreMin: z.number().min(0).max(100).default(85),
    riskScoreMax: z.number().min(0).max(100).default(30),
    momentumScoreMin: z.number().min(0).max(100).default(70),
    liquidityScoreMin: z.number().min(0).max(100).default(60),
    buyPressureScoreMin: z.number().min(0).max(100).default(65),
    scoreWeights: ScoreWeightsSchema.default(DEFAULT_SCORE_WEIGHTS),

    // Position sizing / exits
    positionSizeSol: z.number().positive(),
    stopLossPercent: z.number().positive(),
    stopLossMode: StopLossModeSchema.default('FIXED'),
    takeProfitLevels: z.array(TakeProfitLevelSchema).default([]),
    trailingStopPercent: z.number().positive().nullable(),
    maxHoldingTimeSeconds: z.number().int().positive().nullable(),

    // Scalping limits (also enforced independently by the Risk Engine)
    maxPositions: z.number().int().positive(),
    maxTradesPerDay: z.number().int().positive(),
    maxDailyLossSol: z.number().positive(),
    maxSlippageBps: z.number().int().nonnegative(),

    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
});

export const StrategyConfigSchema = StrategyConfigObjectSchema.superRefine(validateTakeProfitLevels);
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

/** For API input validation: every field except id/userId/timestamps (server-assigned), with the same take-profit refinement. */
export const StrategyConfigInputSchema = StrategyConfigObjectSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
}).superRefine(validateTakeProfitLevels);
