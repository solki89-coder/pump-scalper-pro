import type { ScoreWeights, TokenScores, TokenSnapshot } from '@pump-scalper/shared';
import { DEFAULT_SCORE_WEIGHTS } from '@pump-scalper/shared';

/**
 * These are heuristic, tunable formulas — not "the" objectively correct
 * token-risk model. Every magic number here is a threshold the user can
 * override via `ScoringThresholds`; every sub-score's relative importance
 * is controlled via `ScoreWeights` (Strategy Builder, Phase 10). A single
 * TokenSnapshot carries no price/volume history, so "momentum" is
 * approximated from current activity relative to token age rather than a
 * true trend — documented per function below.
 *
 * Missing data (nulls — see README's data-source table) is never treated
 * as "safe by default": every function below resolves an unknown input to
 * a conservative (low-opportunity / elevated-risk) score, matching the
 * Risk Engine's own "unknown ⇒ do not assume safe" rule.
 */
export interface ScoringThresholds {
  /** Liquidity (SOL) at which liquidityScore saturates at 100. */
  targetLiquiditySol: number;
  /** 5-minute volume (SOL) at which the volume contribution saturates at 100. */
  targetVolumeSol5m: number;
  /** Holder count at which the holder-count component of holderScore saturates at 100. */
  targetHolderCount: number;
}

export const DEFAULT_SCORING_THRESHOLDS: ScoringThresholds = {
  targetLiquiditySol: 15,
  targetVolumeSol5m: 8,
  targetHolderCount: 100,
};

function clamp0to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function scaleToTarget(value: number, target: number): number {
  if (target <= 0) return 0;
  return clamp0to100((value / target) * 100);
}

/** No liquidity data ⇒ scored as if there were no liquidity, not skipped. */
export function computeLiquidityScore(snapshot: TokenSnapshot, t: ScoringThresholds = DEFAULT_SCORING_THRESHOLDS): number {
  if (snapshot.liquiditySol === null) return 0;
  return scaleToTarget(snapshot.liquiditySol, t.targetLiquiditySol);
}

/** No volume data ⇒ scored as zero activity. */
export function computeVolumeScore(snapshot: TokenSnapshot, t: ScoringThresholds = DEFAULT_SCORING_THRESHOLDS): number {
  if (snapshot.volumeSol5m === null) return 0;
  return scaleToTarget(snapshot.volumeSol5m, t.targetVolumeSol5m);
}

/** No trade-count data ⇒ neutral (50), since we genuinely don't know the direction. */
export function computeBuyPressureScore(snapshot: TokenSnapshot): number {
  const buys = snapshot.buys5m;
  const sells = snapshot.sells5m;
  if (buys === null || sells === null || buys + sells === 0) return 50;
  return clamp0to100((buys / (buys + sells)) * 100);
}

/**
 * Approximated as recent activity (volume + buy pressure) discounted by how
 * long ago the token launched — a snapshot alone has no price/volume
 * history to compute a true trend from. Activity in the first 10 minutes
 * counts fully; the weight decays afterward so a token that has simply
 * been trading steadily for hours doesn't read as "high momentum" forever.
 */
export function computeMomentumScore(snapshot: TokenSnapshot, t: ScoringThresholds = DEFAULT_SCORING_THRESHOLDS): number {
  const volumeScore = computeVolumeScore(snapshot, t);
  const buyPressure = computeBuyPressureScore(snapshot);
  const ageMinutes = snapshot.ageSeconds / 60;
  const freshnessFactor = ageMinutes <= 10 ? 1 : Math.max(0.3, 10 / ageMinutes);
  return clamp0to100((volumeScore * 0.6 + buyPressure * 0.4) * freshnessFactor);
}

/**
 * Blends holder-concentration risk (top holder %, lower is better) with
 * raw holder count. Both are currently unavailable without a paid indexer
 * (see README) — when both are null, scores a deliberately mediocre 30
 * rather than a neutral 50, since an unknown, unauditable holder base is a
 * genuine unknown-risk, not a coin flip.
 */
export function computeHolderScore(snapshot: TokenSnapshot, t: ScoringThresholds = DEFAULT_SCORING_THRESHOLDS): number {
  const concentration = snapshot.topHolderConcentrationPercent;
  const holders = snapshot.holders;
  if (concentration === null && holders === null) return 30;
  const concentrationScore = concentration === null ? 40 : clamp0to100(100 - concentration);
  const holderCountScore = holders === null ? 40 : scaleToTarget(holders, t.targetHolderCount);
  return clamp0to100(concentrationScore * 0.6 + holderCountScore * 0.4);
}

/**
 * Higher = riskier. Unknown creator holding scores 60 (elevated, not low)
 * — never assume an unaudited creator holds nothing.
 */
export function computeCreatorRiskScore(snapshot: TokenSnapshot): number {
  const holding = snapshot.creatorHoldingPercent;
  if (holding === null) return 60;
  return clamp0to100(holding * 2.5); // >= 40% creator holding maxes out risk
}

/** Higher = riskier. Combines creator risk, illiquidity, holder concentration, and raw newness. */
export function computeRiskScore(snapshot: TokenSnapshot, t: ScoringThresholds = DEFAULT_SCORING_THRESHOLDS): number {
  const creatorRisk = computeCreatorRiskScore(snapshot);
  const liquidityRisk = 100 - computeLiquidityScore(snapshot, t);
  const concentration = snapshot.topHolderConcentrationPercent;
  const concentrationRisk = concentration === null ? 50 : clamp0to100(concentration * 1.5);
  const ageMinutes = snapshot.ageSeconds / 60;
  const ageRisk = ageMinutes < 2 ? 70 : ageMinutes < 10 ? 40 : 15;
  return clamp0to100(creatorRisk * 0.35 + liquidityRisk * 0.3 + concentrationRisk * 0.2 + ageRisk * 0.15);
}

export interface OpportunityInputs {
  momentumScore: number;
  liquidityScore: number;
  volumeScore: number;
  buyPressureScore: number;
  holderScore: number;
  creatorRiskScore: number;
}

/** Risk is inverted into a "safety" contribution (100 - creatorRiskScore) before blending. */
export function computeOpportunityScore(inputs: OpportunityInputs, weights: ScoreWeights): number {
  const totalWeight =
    weights.momentumWeight +
    weights.liquidityWeight +
    weights.volumeWeight +
    weights.buyPressureWeight +
    weights.holderWeight +
    weights.creatorRiskWeight;
  if (totalWeight <= 0) return 0;

  const safetyScore = 100 - inputs.creatorRiskScore;
  const weighted =
    inputs.momentumScore * weights.momentumWeight +
    inputs.liquidityScore * weights.liquidityWeight +
    inputs.volumeScore * weights.volumeWeight +
    inputs.buyPressureScore * weights.buyPressureWeight +
    inputs.holderScore * weights.holderWeight +
    safetyScore * weights.creatorRiskWeight;
  return clamp0to100(weighted / totalWeight);
}

export function scoreToken(
  snapshot: TokenSnapshot,
  weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
  thresholds: ScoringThresholds = DEFAULT_SCORING_THRESHOLDS,
): TokenScores {
  const momentumScore = computeMomentumScore(snapshot, thresholds);
  const liquidityScore = computeLiquidityScore(snapshot, thresholds);
  const volumeScore = computeVolumeScore(snapshot, thresholds);
  const buyPressureScore = computeBuyPressureScore(snapshot);
  const holderScore = computeHolderScore(snapshot, thresholds);
  const creatorRiskScore = computeCreatorRiskScore(snapshot);
  const riskScore = computeRiskScore(snapshot, thresholds);
  const opportunityScore = computeOpportunityScore(
    { momentumScore, liquidityScore, volumeScore, buyPressureScore, holderScore, creatorRiskScore },
    weights,
  );

  return {
    mint: snapshot.mint,
    opportunityScore,
    riskScore,
    momentumScore,
    liquidityScore,
    buyPressureScore,
    holderScore,
    creatorRiskScore,
    computedAt: new Date().toISOString(),
  };
}
