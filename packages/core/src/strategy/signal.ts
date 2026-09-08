import type { SignalType, StrategyConfig, TokenScores, TokenSnapshot } from '@pump-scalper/shared';
import { matchesStrategyFilters } from './filters.js';

export interface SignalEvaluation {
  signal: SignalType;
  reason: string;
}

/** How far above the strategy's minimums opportunityScore/riskScore need to be to upgrade BUY to STRONG_BUY. */
const STRONG_BUY_MARGIN = 10;
/** How close a token can be to the thresholds without meeting them and still be worth a human's attention (WATCH) rather than an outright REJECT. */
const WATCH_MARGIN = 15;
/** How far riskScore needs to climb past a strategy's cap on an *open* position before it's worth flagging for exit. */
const HOLD_RISK_DETERIORATION_MARGIN = 25;

/**
 * The Signal Engine: turns a token's filters + scores into one of
 * STRONG_BUY / BUY / WATCH / WAIT / REJECT for a specific strategy.
 * A BUY/STRONG_BUY signal is a *candidate* only — per spec, it still has to
 * pass the Risk Engine (Phase 8) before anything executes. This function
 * has no side effects and knows nothing about risk limits, balances, or
 * open positions.
 */
export function evaluateSignal(snapshot: TokenSnapshot, scores: TokenScores, strategy: StrategyConfig): SignalEvaluation {
  if (snapshot.name === 'PENDING_METADATA') {
    return { signal: 'WAIT', reason: 'Token metadata not yet indexed by the market-data adapter' };
  }

  const filterResult = matchesStrategyFilters(snapshot, strategy);
  if (!filterResult.matches) {
    return { signal: 'REJECT', reason: `Failed filters: ${filterResult.failedFilters.join(', ')}` };
  }

  const opportunityOk = scores.opportunityScore >= strategy.opportunityScoreMin;
  const riskOk = scores.riskScore <= strategy.riskScoreMax;
  const momentumOk = scores.momentumScore >= strategy.momentumScoreMin;
  const liquidityOk = scores.liquidityScore >= strategy.liquidityScoreMin;
  const buyPressureOk = scores.buyPressureScore >= strategy.buyPressureScoreMin;

  if (opportunityOk && riskOk && momentumOk && liquidityOk && buyPressureOk) {
    const comfortablyStrong =
      scores.opportunityScore >= strategy.opportunityScoreMin + STRONG_BUY_MARGIN &&
      scores.riskScore <= strategy.riskScoreMax - STRONG_BUY_MARGIN;
    return {
      signal: comfortablyStrong ? 'STRONG_BUY' : 'BUY',
      reason: 'Meets all score thresholds and discovery filters',
    };
  }

  const withinWatchBand =
    scores.opportunityScore >= strategy.opportunityScoreMin - WATCH_MARGIN &&
    scores.riskScore <= strategy.riskScoreMax + WATCH_MARGIN;
  if (withinWatchBand) {
    return { signal: 'WATCH', reason: 'Close to thresholds but not yet meeting all of them' };
  }

  const failedChecks = [
    !opportunityOk && 'opportunityScore',
    !riskOk && 'riskScore',
    !momentumOk && 'momentumScore',
    !liquidityOk && 'liquidityScore',
    !buyPressureOk && 'buyPressureScore',
  ].filter(Boolean);
  return { signal: 'REJECT', reason: `Fails score thresholds: ${failedChecks.join(', ')}` };
}

/**
 * For an already-open position: signals SELL only when risk has
 * deteriorated well past the strategy's own cap — this is a coarse
 * early-warning, not a replacement for the Phase 9 TP/SL/trailing engine
 * (which triggers on price, not on score re-evaluation).
 */
export function evaluateHoldSignal(scores: TokenScores, strategy: StrategyConfig): SignalEvaluation | null {
  if (scores.riskScore >= strategy.riskScoreMax + HOLD_RISK_DETERIORATION_MARGIN) {
    return { signal: 'SELL', reason: `Risk score ${scores.riskScore} has deteriorated well past the strategy's cap of ${strategy.riskScoreMax}` };
  }
  return null;
}
