import { checkTrade, type RiskCheckInput } from '@pump-scalper/core';
import type { RiskCheckResult, RiskConfig, TradingMode } from '@pump-scalper/shared';

export interface RiskGatePorts {
  getBotState(userId: string): Promise<{ killSwitchActive: boolean }>;
  countOpenPositions(userId: string): Promise<number>;
  sumOpenExposureSol(userId: string): Promise<number>;
  countTradesToday(userId: string): Promise<number>;
  sumRealizedPnlSince(userId: string, since: Date | null): Promise<number>;
  recordRiskEvent(event: {
    userId: string;
    mint: string | null;
    strategyId: string | null;
    reasons: RiskCheckResult['reasons'];
    attemptedSizeSol: number;
    details: Record<string, unknown>;
  }): Promise<void>;
  isLiveTradingEnabled(): boolean;
}

export interface TradeRequest {
  userId: string;
  mint: string | null;
  strategyId: string | null;
  mode: TradingMode;
  isAutonomous: boolean;
  sizeSol: number;
  slippageBps: number;
  currentSolBalance: number;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The single entry point every trade (manual, strategy, autonomous) must
 * call before execution. Gathers live state from the database and
 * delegates the actual decision to the pure `checkTrade()` in
 * @pump-scalper/core — this function's only job is fetching inputs and
 * recording the outcome, never deciding. Every rejection is persisted as a
 * risk_event (Phase 2), matching the spec's audit-log requirement.
 */
export async function evaluateTrade(
  request: TradeRequest,
  riskConfig: RiskConfig,
  ports: RiskGatePorts,
): Promise<RiskCheckResult> {
  const [botState, openPositions, exposure, tradesToday, dailyPnl] = await Promise.all([
    ports.getBotState(request.userId),
    ports.countOpenPositions(request.userId),
    ports.sumOpenExposureSol(request.userId),
    ports.countTradesToday(request.userId),
    ports.sumRealizedPnlSince(request.userId, startOfToday()),
  ]);

  const input: RiskCheckInput = {
    mode: request.mode,
    isAutonomous: request.isAutonomous,
    sizeSol: request.sizeSol,
    slippageBps: request.slippageBps,
    currentSolBalance: request.currentSolBalance,
    openPositionsCount: openPositions,
    currentTotalExposureSol: exposure,
    tradesTodayCount: tradesToday,
    realizedDailyLossSol: Math.max(0, -dailyPnl),
    killSwitchActive: botState.killSwitchActive,
    liveTradingEnabled: ports.isLiveTradingEnabled(),
  };

  const result = checkTrade(input, riskConfig);

  if (!result.approved) {
    await ports.recordRiskEvent({
      userId: request.userId,
      mint: request.mint,
      strategyId: request.strategyId,
      reasons: result.reasons,
      attemptedSizeSol: request.sizeSol,
      details: { mode: request.mode, isAutonomous: request.isAutonomous },
    });
  }

  return result;
}
