import { DEFAULT_SCORE_WEIGHTS } from '@pump-scalper/shared';
import { describe, expect, it } from 'vitest';
import {
  computeBuyPressureScore,
  computeCreatorRiskScore,
  computeHolderScore,
  computeLiquidityScore,
  computeMomentumScore,
  computeOpportunityScore,
  computeRiskScore,
  computeVolumeScore,
  scoreToken,
} from '../src/scoring.js';
import { baseSnapshot } from './fixtures.js';

describe('computeLiquidityScore', () => {
  it('scales linearly up to the target and saturates at 100', () => {
    expect(computeLiquidityScore(baseSnapshot({ liquiditySol: 7.5 }))).toBeCloseTo(50, 5); // target=15
    expect(computeLiquidityScore(baseSnapshot({ liquiditySol: 30 }))).toBe(100);
    expect(computeLiquidityScore(baseSnapshot({ liquiditySol: 0 }))).toBe(0);
  });

  it('treats missing liquidity data as zero liquidity, not skipped', () => {
    expect(computeLiquidityScore(baseSnapshot({ liquiditySol: null }))).toBe(0);
  });
});

describe('computeVolumeScore', () => {
  it('scales to the target and treats missing data as zero', () => {
    expect(computeVolumeScore(baseSnapshot({ volumeSol5m: 4 }))).toBeCloseTo(50, 5); // target=8
    expect(computeVolumeScore(baseSnapshot({ volumeSol5m: null }))).toBe(0);
  });
});

describe('computeBuyPressureScore', () => {
  it('is 100 for buy-only activity and 0 for sell-only', () => {
    expect(computeBuyPressureScore(baseSnapshot({ buys5m: 10, sells5m: 0 }))).toBe(100);
    expect(computeBuyPressureScore(baseSnapshot({ buys5m: 0, sells5m: 10 }))).toBe(0);
  });

  it('is neutral (50) with no trade data', () => {
    expect(computeBuyPressureScore(baseSnapshot({ buys5m: null, sells5m: null }))).toBe(50);
    expect(computeBuyPressureScore(baseSnapshot({ buys5m: 0, sells5m: 0 }))).toBe(50);
  });
});

describe('computeMomentumScore', () => {
  it('decays for identical activity as the token ages past 10 minutes', () => {
    const fresh = computeMomentumScore(baseSnapshot({ ageSeconds: 60, volumeSol5m: 8, buys5m: 10, sells5m: 0 }));
    const stale = computeMomentumScore(baseSnapshot({ ageSeconds: 3600, volumeSol5m: 8, buys5m: 10, sells5m: 0 }));
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBe(100); // full volume + full buy pressure, no age discount within 10 min
  });
});

describe('computeHolderScore', () => {
  it('rewards low concentration and high holder count', () => {
    const concentrated = computeHolderScore(baseSnapshot({ topHolderConcentrationPercent: 80, holders: 5 }));
    const distributed = computeHolderScore(baseSnapshot({ topHolderConcentrationPercent: 5, holders: 200 }));
    expect(distributed).toBeGreaterThan(concentrated);
  });

  it('scores a deliberately mediocre 30 — not neutral 50 — when both fields are unknown', () => {
    expect(computeHolderScore(baseSnapshot({ topHolderConcentrationPercent: null, holders: null }))).toBe(30);
  });
});

describe('computeCreatorRiskScore', () => {
  it('increases with creator holding percent and treats unknown as elevated (60), not safe', () => {
    expect(computeCreatorRiskScore(baseSnapshot({ creatorHoldingPercent: 0 }))).toBe(0);
    expect(computeCreatorRiskScore(baseSnapshot({ creatorHoldingPercent: 40 }))).toBe(100);
    expect(computeCreatorRiskScore(baseSnapshot({ creatorHoldingPercent: null }))).toBe(60);
  });
});

describe('computeRiskScore', () => {
  it('is higher for a brand-new, illiquid, concentrated, creator-heavy token', () => {
    const risky = computeRiskScore(
      baseSnapshot({ ageSeconds: 30, liquiditySol: 0.1, topHolderConcentrationPercent: 90, creatorHoldingPercent: 50 }),
    );
    const safer = computeRiskScore(
      baseSnapshot({ ageSeconds: 3600, liquiditySol: 40, topHolderConcentrationPercent: 5, creatorHoldingPercent: 1 }),
    );
    expect(risky).toBeGreaterThan(safer);
  });
});

describe('computeOpportunityScore', () => {
  const inputs = {
    momentumScore: 80,
    liquidityScore: 70,
    volumeScore: 60,
    buyPressureScore: 90,
    holderScore: 50,
    creatorRiskScore: 20,
  };

  it('inverts creatorRiskScore into a safety contribution', () => {
    const lowRisk = computeOpportunityScore({ ...inputs, creatorRiskScore: 0 }, DEFAULT_SCORE_WEIGHTS);
    const highRisk = computeOpportunityScore({ ...inputs, creatorRiskScore: 100 }, DEFAULT_SCORE_WEIGHTS);
    expect(lowRisk).toBeGreaterThan(highRisk);
  });

  it('respects relative weighting — zeroing every weight but one isolates that score', () => {
    const onlyMomentum = computeOpportunityScore(inputs, {
      momentumWeight: 1,
      liquidityWeight: 0,
      volumeWeight: 0,
      buyPressureWeight: 0,
      holderWeight: 0,
      creatorRiskWeight: 0,
    });
    expect(onlyMomentum).toBe(inputs.momentumScore);
  });

  it('returns 0 when all weights are zero rather than dividing by zero', () => {
    const result = computeOpportunityScore(inputs, {
      momentumWeight: 0,
      liquidityWeight: 0,
      volumeWeight: 0,
      buyPressureWeight: 0,
      holderWeight: 0,
      creatorRiskWeight: 0,
    });
    expect(result).toBe(0);
  });
});

describe('scoreToken', () => {
  it('produces every sub-score in [0, 100] and stamps the mint + computedAt', () => {
    const scores = scoreToken(baseSnapshot());
    for (const key of ['opportunityScore', 'riskScore', 'momentumScore', 'liquidityScore', 'buyPressureScore', 'holderScore', 'creatorRiskScore'] as const) {
      expect(scores[key]).toBeGreaterThanOrEqual(0);
      expect(scores[key]).toBeLessThanOrEqual(100);
    }
    expect(scores.mint).toBe('Mint1111111111111111111111111111111111111');
    expect(() => new Date(scores.computedAt).toISOString()).not.toThrow();
  });

  it('scores a token with zero market data conservatively across the board', () => {
    const scores = scoreToken(
      baseSnapshot({
        liquiditySol: null,
        volumeSol5m: null,
        buys5m: null,
        sells5m: null,
        holders: null,
        topHolderConcentrationPercent: null,
        creatorHoldingPercent: null,
      }),
    );
    expect(scores.opportunityScore).toBeLessThan(40);
    expect(scores.riskScore).toBeGreaterThan(40);
  });
});
