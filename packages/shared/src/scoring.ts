import { z } from 'zod';

/**
 * Relative weights used to blend the sub-scores into the Opportunity Score.
 * Values are relative weights (not required to sum to 1) — the score engine
 * normalizes by their sum.
 */
export const ScoreWeightsSchema = z.object({
  momentumWeight: z.number().min(0).default(1),
  liquidityWeight: z.number().min(0).default(1),
  volumeWeight: z.number().min(0).default(1),
  buyPressureWeight: z.number().min(0).default(1),
  holderWeight: z.number().min(0).default(1),
  creatorRiskWeight: z.number().min(0).default(1),
});
export type ScoreWeights = z.infer<typeof ScoreWeightsSchema>;

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  momentumWeight: 1,
  liquidityWeight: 1,
  volumeWeight: 1,
  buyPressureWeight: 1,
  holderWeight: 1,
  creatorRiskWeight: 1,
};

const Score0to100 = z.number().min(0).max(100);

export const TokenScoresSchema = z.object({
  mint: z.string(),
  opportunityScore: Score0to100,
  riskScore: Score0to100,
  momentumScore: Score0to100,
  liquidityScore: Score0to100,
  buyPressureScore: Score0to100,
  holderScore: Score0to100,
  creatorRiskScore: Score0to100,
  computedAt: z.string().datetime(),
});
export type TokenScores = z.infer<typeof TokenScoresSchema>;
