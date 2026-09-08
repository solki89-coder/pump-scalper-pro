import type { RiskCheckResult, RiskConfig, RiskRejectReason, TradingMode } from '@pump-scalper/shared';

export interface RiskCheckInput {
  mode: TradingMode;
  isAutonomous: boolean;
  sizeSol: number;
  /** The trade's expected/quoted slippage — checked against maxSlippageBps regardless of mode. */
  slippageBps: number;
  currentSolBalance: number;
  openPositionsCount: number;
  /** Sum of current value (SOL) of all open positions, before this trade. */
  currentTotalExposureSol: number;
  tradesTodayCount: number;
  /** Realized loss so far today, as a positive number (0 if net positive/flat). */
  realizedDailyLossSol: number;
  killSwitchActive: boolean;
  /** From ENABLE_LIVE_TRADING — irrelevant for PAPER trades. */
  liveTradingEnabled: boolean;
}

/**
 * The Risk Engine: a pure, synchronous gatekeeper. Every trade — manual,
 * strategy-triggered, or autonomous — must be approved here before
 * anything executes. Nothing in this codebase is permitted to skip this
 * call; there is deliberately no "trusted caller" bypass. All applicable
 * checks run every time (not short-circuited on the first failure) so a
 * caller sees every reason a trade was rejected, not just the first one.
 */
export function checkTrade(input: RiskCheckInput, config: RiskConfig): RiskCheckResult {
  const reasons: RiskRejectReason[] = [];

  if (input.killSwitchActive) reasons.push('KILL_SWITCH_ACTIVE');
  if (input.mode === 'LIVE' && !input.liveTradingEnabled) reasons.push('LIVE_TRADING_DISABLED');

  if (input.sizeSol > config.maxPositionSizeSol) reasons.push('MAX_POSITION_SIZE');
  if (input.currentSolBalance - input.sizeSol < config.minSolBalance) reasons.push('MIN_SOL_BALANCE');
  if (input.openPositionsCount >= config.maxOpenPositions) reasons.push('MAX_OPEN_POSITIONS');
  if (input.tradesTodayCount >= config.maxTradesPerDay) reasons.push('MAX_TRADES_PER_DAY');
  if (input.slippageBps > config.maxSlippageBps) reasons.push('MAX_SLIPPAGE');
  if (input.currentTotalExposureSol + input.sizeSol > config.maxTotalExposureSol) reasons.push('MAX_TOTAL_EXPOSURE');
  if (input.realizedDailyLossSol >= config.maxDailyLossSol) reasons.push('MAX_DAILY_LOSS');
  if (input.currentTotalExposureSol + input.sizeSol > config.tradingAllocationSol) {
    reasons.push('TRADING_ALLOCATION_EXCEEDED');
  }

  if (input.isAutonomous) {
    if (!config.autonomousEnabled) reasons.push('AUTONOMOUS_DISABLED');
    if (config.autonomousMaxPositionSol !== null && input.sizeSol > config.autonomousMaxPositionSol) {
      reasons.push('AUTONOMOUS_MAX_POSITION');
    }
    if (config.autonomousMaxDailyLossSol !== null && input.realizedDailyLossSol >= config.autonomousMaxDailyLossSol) {
      reasons.push('AUTONOMOUS_MAX_DAILY_LOSS');
    }
    if (config.autonomousMaxTrades !== null && input.tradesTodayCount >= config.autonomousMaxTrades) {
      reasons.push('AUTONOMOUS_MAX_TRADES');
    }
  }

  return { approved: reasons.length === 0, reasons, checkedAt: new Date().toISOString() };
}
