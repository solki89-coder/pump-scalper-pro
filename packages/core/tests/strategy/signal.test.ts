import { describe, expect, it } from 'vitest';
import { evaluateHoldSignal, evaluateSignal } from '../../src/strategy/signal.js';
import { baseScores, baseSnapshot, baseStrategy } from '../fixtures.js';

describe('evaluateSignal', () => {
  it('returns WAIT for a token still pending metadata enrichment, before any filter/score check', () => {
    const result = evaluateSignal(baseSnapshot({ name: 'PENDING_METADATA' }), baseScores(), baseStrategy());
    expect(result.signal).toBe('WAIT');
  });

  it('returns REJECT when discovery filters fail, regardless of scores', () => {
    const result = evaluateSignal(baseSnapshot({ liquiditySol: 0.01 }), baseScores(), baseStrategy());
    expect(result.signal).toBe('REJECT');
    expect(result.reason).toContain('liquiditySol');
  });

  it('returns STRONG_BUY when scores comfortably clear the thresholds', () => {
    const strategy = baseStrategy({ opportunityScoreMin: 80, riskScoreMax: 30 });
    const scores = baseScores({ opportunityScore: 95, riskScore: 10 });
    const result = evaluateSignal(baseSnapshot(), scores, strategy);
    expect(result.signal).toBe('STRONG_BUY');
  });

  it('returns BUY when scores meet but do not comfortably exceed the thresholds', () => {
    const strategy = baseStrategy({ opportunityScoreMin: 85, riskScoreMax: 30 });
    const scores = baseScores({ opportunityScore: 86, riskScore: 28, momentumScore: 70, liquidityScore: 60, buyPressureScore: 65 });
    const result = evaluateSignal(baseSnapshot(), scores, strategy);
    expect(result.signal).toBe('BUY');
  });

  it('returns WATCH when close to but not meeting thresholds', () => {
    const strategy = baseStrategy({ opportunityScoreMin: 85, riskScoreMax: 30 });
    const scores = baseScores({ opportunityScore: 75, riskScore: 35 });
    const result = evaluateSignal(baseSnapshot(), scores, strategy);
    expect(result.signal).toBe('WATCH');
  });

  it('returns REJECT when far from meeting thresholds', () => {
    const strategy = baseStrategy({ opportunityScoreMin: 85, riskScoreMax: 30 });
    const scores = baseScores({ opportunityScore: 20, riskScore: 90 });
    const result = evaluateSignal(baseSnapshot(), scores, strategy);
    expect(result.signal).toBe('REJECT');
    expect(result.reason).toContain('opportunityScore');
  });

  it('requires every score threshold, not just opportunity/risk', () => {
    const strategy = baseStrategy({ opportunityScoreMin: 80, riskScoreMax: 40, momentumScoreMin: 90 });
    const scores = baseScores({ opportunityScore: 95, riskScore: 10, momentumScore: 50 }); // momentum fails
    const result = evaluateSignal(baseSnapshot(), scores, strategy);
    expect(result.signal).not.toBe('BUY');
    expect(result.signal).not.toBe('STRONG_BUY');
  });
});

describe('evaluateHoldSignal', () => {
  it('returns null (hold) when risk is within a reasonable band above the cap', () => {
    const strategy = baseStrategy({ riskScoreMax: 30 });
    expect(evaluateHoldSignal(baseScores({ riskScore: 40 }), strategy)).toBeNull();
  });

  it('returns SELL when risk has deteriorated well past the cap', () => {
    const strategy = baseStrategy({ riskScoreMax: 30 });
    const result = evaluateHoldSignal(baseScores({ riskScore: 70 }), strategy);
    expect(result?.signal).toBe('SELL');
  });
});
