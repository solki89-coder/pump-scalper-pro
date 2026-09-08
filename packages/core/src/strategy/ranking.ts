import type { SignalType, TokenScores } from '@pump-scalper/shared';

export interface RankableCandidate {
  mint: string;
  scores: TokenScores;
  signal: SignalType;
}

/**
 * The Autonomous Engine's RANK step: orders BUY/STRONG_BUY candidates by
 * opportunityScore (STRONG_BUY first, ties broken by opportunityScore then
 * lower riskScore). Everything else (WATCH/WAIT/REJECT/SELL) is filtered
 * out — the autonomous engine only ever considers actual buy candidates
 * here. This is pure ranking: it does not check risk limits, balances, or
 * position counts — the Risk Engine (Phase 8) is what actually decides
 * whether the top-ranked candidate may be bought.
 */
export function rankCandidates(candidates: RankableCandidate[]): RankableCandidate[] {
  return candidates
    .filter((c) => c.signal === 'STRONG_BUY' || c.signal === 'BUY')
    .sort((a, b) => {
      if (a.signal !== b.signal) return a.signal === 'STRONG_BUY' ? -1 : 1;
      if (b.scores.opportunityScore !== a.scores.opportunityScore) {
        return b.scores.opportunityScore - a.scores.opportunityScore;
      }
      return a.scores.riskScore - b.scores.riskScore;
    });
}
