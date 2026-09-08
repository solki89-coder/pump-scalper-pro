import { describe, expect, it } from 'vitest';
import { rankCandidates, type RankableCandidate } from '../../src/strategy/ranking.js';
import { baseScores } from '../fixtures.js';

function candidate(mint: string, overrides: Partial<RankableCandidate> = {}): RankableCandidate {
  return { mint, scores: baseScores(), signal: 'BUY', ...overrides };
}

describe('rankCandidates', () => {
  it('filters out everything except BUY and STRONG_BUY', () => {
    const ranked = rankCandidates([
      candidate('watch', { signal: 'WATCH' }),
      candidate('reject', { signal: 'REJECT' }),
      candidate('wait', { signal: 'WAIT' }),
      candidate('sell', { signal: 'SELL' }),
      candidate('buy', { signal: 'BUY' }),
    ]);
    expect(ranked.map((c) => c.mint)).toEqual(['buy']);
  });

  it('puts every STRONG_BUY ahead of every BUY', () => {
    const ranked = rankCandidates([
      candidate('buyHigh', { signal: 'BUY', scores: baseScores({ opportunityScore: 99 }) }),
      candidate('strongLow', { signal: 'STRONG_BUY', scores: baseScores({ opportunityScore: 60 }) }),
    ]);
    expect(ranked.map((c) => c.mint)).toEqual(['strongLow', 'buyHigh']);
  });

  it('within the same signal, sorts by opportunityScore descending', () => {
    const ranked = rankCandidates([
      candidate('low', { scores: baseScores({ opportunityScore: 70 }) }),
      candidate('high', { scores: baseScores({ opportunityScore: 95 }) }),
      candidate('mid', { scores: baseScores({ opportunityScore: 80 }) }),
    ]);
    expect(ranked.map((c) => c.mint)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks opportunityScore ties by lower riskScore', () => {
    const ranked = rankCandidates([
      candidate('riskier', { scores: baseScores({ opportunityScore: 90, riskScore: 40 }) }),
      candidate('safer', { scores: baseScores({ opportunityScore: 90, riskScore: 10 }) }),
    ]);
    expect(ranked.map((c) => c.mint)).toEqual(['safer', 'riskier']);
  });

  it('returns an empty array when nothing qualifies', () => {
    expect(rankCandidates([candidate('a', { signal: 'WAIT' })])).toEqual([]);
  });
});
