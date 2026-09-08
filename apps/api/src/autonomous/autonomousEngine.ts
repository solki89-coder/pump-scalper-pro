import { evaluateSignal, rankCandidates, scoreToken, type RankableCandidate } from '@pump-scalper/core';
import type { Position, RiskCheckResult, RiskConfig, StrategyConfig, TokenScores, TokenSnapshot, Trade } from '@pump-scalper/shared';
import type { TelegramAlertsPort } from '../telegram/alerts.js';
import type { TradeRequest } from '../risk/riskGate.js';

export interface AutonomousCycleInput {
  userId: string;
  /** Pre-filtered to strategies that are both enabled and autonomous for this user. */
  strategies: StrategyConfig[];
  /** Recently discovered/active tokens without an already-open position for this user. */
  candidateTokens: TokenSnapshot[];
  killSwitchActive: boolean;
  botMode: 'PAPER' | 'LIVE';
}

export interface AutonomousCyclePorts {
  getRiskConfig(userId: string): Promise<RiskConfig | null>;
  getSolBalance(): Promise<number>;
  evaluateTrade(request: TradeRequest, riskConfig: RiskConfig): Promise<RiskCheckResult>;
  estimateSlippageBps(sizeSol: number, liquiditySol: number): number;
  openPaperPosition(
    strategy: StrategyConfig,
    snapshot: TokenSnapshot,
    scores: TokenScores,
  ): Promise<{ position: Position; trade: Trade }>;
  /** Optional — omitted in most tests via fakePorts(); alert calls become no-ops when absent. */
  alerts?: TelegramAlertsPort;
}

export interface AutonomousCycleResult {
  scanned: number;
  candidatesRanked: number;
  opened: { mint: string; strategyId: string | null }[];
  rejectedByRisk: { mint: string; reasons: string[] }[];
  skippedNoRiskConfig: boolean;
}

/**
 * SCAN → ANALYZE → RANK → WAIT/BUY, per spec. One pass, one call. The
 * caller (a scheduler, once wired into the not-yet-existing Fastify app)
 * re-invokes this on an interval; this function itself has no loop or
 * timer so it stays trivially testable.
 *
 * Two hard stops before anything else, both non-negotiable:
 *   1. Kill switch active ⇒ do nothing at all.
 *   2. Bot mode is LIVE ⇒ do nothing. Autonomous *live* trading needs the
 *      live execution engine, which does not exist until Phase 13. Silently
 *      falling back to paper here would misrepresent what "LIVE" means to
 *      the user; refusing outright is the honest behavior until that phase
 *      lands.
 * Every single candidate that reaches the front of the ranked queue still
 * goes through `evaluateTrade` (the real Risk Engine, Phase 8) before
 * `openPaperPosition` is ever called — there is no path here that skips it.
 */
export async function runAutonomousCycle(
  input: AutonomousCycleInput,
  ports: AutonomousCyclePorts,
): Promise<AutonomousCycleResult> {
  const result: AutonomousCycleResult = {
    scanned: input.candidateTokens.length,
    candidatesRanked: 0,
    opened: [],
    rejectedByRisk: [],
    skippedNoRiskConfig: false,
  };

  if (input.killSwitchActive) return result;
  if (input.botMode === 'LIVE') return result;

  for (const strategy of input.strategies) {
    const riskConfig = await ports.getRiskConfig(input.userId);
    if (!riskConfig) {
      result.skippedNoRiskConfig = true;
      continue;
    }

    const scoredByMint = new Map<string, { snapshot: TokenSnapshot; scores: TokenScores }>();
    const candidates: RankableCandidate[] = [];

    for (const snapshot of input.candidateTokens) {
      const scores = scoreToken(snapshot, strategy.scoreWeights);
      const { signal } = evaluateSignal(snapshot, scores, strategy);
      scoredByMint.set(snapshot.mint, { snapshot, scores });
      candidates.push({ mint: snapshot.mint, scores, signal });
    }

    const ranked = rankCandidates(candidates);
    result.candidatesRanked += ranked.length;

    for (const candidate of ranked) {
      const entry = scoredByMint.get(candidate.mint);
      if (!entry) continue;
      const { snapshot, scores } = entry;
      const liquiditySol = snapshot.liquiditySol ?? 0;
      const slippageBps = ports.estimateSlippageBps(strategy.positionSizeSol, liquiditySol);
      const balance = await ports.getSolBalance();

      const riskResult = await ports.evaluateTrade(
        {
          userId: input.userId,
          mint: snapshot.mint,
          strategyId: strategy.id ?? null,
          mode: 'PAPER',
          isAutonomous: true,
          sizeSol: strategy.positionSizeSol,
          slippageBps,
          currentSolBalance: balance,
        },
        riskConfig,
      );

      if (!riskResult.approved) {
        // RISK_REJECT / DAILY_LOSS_LIMIT alerts fire once, centrally, from
        // evaluateTrade() itself (apps/api/src/risk/riskGate.ts) — it's the
        // one place that has the actual computed daily-loss figure, and it
        // covers every caller (manual buys included), not just this one.
        result.rejectedByRisk.push({ mint: snapshot.mint, reasons: riskResult.reasons });
        continue;
      }

      void ports.alerts?.buySignal(snapshot.mint, candidate.signal as 'BUY' | 'STRONG_BUY', scores.opportunityScore, scores.riskScore);
      const { position } = await ports.openPaperPosition(strategy, snapshot, scores);
      void ports.alerts?.buyExecuted(position);
      result.opened.push({ mint: snapshot.mint, strategyId: strategy.id ?? null });
    }
  }

  return result;
}
