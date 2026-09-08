import type { BotState, PnlAnalytics, Position, RiskCheckResult, RiskConfig, StrategyConfig, TokenSnapshot, Trade } from '@pump-scalper/shared';

function sol(n: number, digits = 4): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)} SOL`;
}

export function formatStatus(state: BotState, balance: number): string {
  return [
    `*Status:* ${state.status}`,
    `*Mode:* ${state.mode}`,
    `*Kill switch:* ${state.killSwitchActive ? `ACTIVE (${state.killSwitchReason ?? 'no reason given'})` : 'off'}`,
    `*Balance:* ${balance.toFixed(4)} SOL`,
  ].join('\n');
}

export function formatPnl(analytics: PnlAnalytics): string {
  return [
    `*Total PnL:* ${sol(analytics.totalPnlSol)}`,
    `*Win rate:* ${analytics.winRate.toFixed(1)}% (${analytics.winningTrades}/${analytics.totalTrades})`,
    `*Profit factor:* ${analytics.profitFactor === null ? 'n/a' : analytics.profitFactor.toFixed(2)}`,
    `*Max drawdown:* ${analytics.maxDrawdownPercent.toFixed(1)}%`,
    `*Best / worst trade:* ${analytics.bestTradeSol === null ? 'n/a' : sol(analytics.bestTradeSol)} / ${analytics.worstTradeSol === null ? 'n/a' : sol(analytics.worstTradeSol)}`,
  ].join('\n');
}

export function formatPositions(positions: Position[]): string {
  if (positions.length === 0) return 'No open positions.';
  return positions
    .map((p) => `*${p.tokenSymbol}* ${sol(p.unrealizedPnlSol)} (${p.unrealizedPnlPercent.toFixed(1)}%) — entry ${p.entryPrice.toPrecision(4)}`)
    .join('\n');
}

export function formatTokens(tokens: TokenSnapshot[]): string {
  if (tokens.length === 0) return 'No tokens discovered yet.';
  return tokens
    .slice(0, 10)
    .map((t) => `*${t.symbol === 'PENDING_METADATA' ? t.mint.slice(0, 8) + '…' : t.symbol}* — age ${Math.round(t.ageSeconds)}s, liq ${t.liquiditySol?.toFixed(2) ?? '?'} SOL`)
    .join('\n');
}

export function formatRiskConfig(config: RiskConfig): string {
  return [
    `*Max position:* ${config.maxPositionSizeSol} SOL`,
    `*Max daily loss:* ${config.maxDailyLossSol} SOL`,
    `*Max exposure:* ${config.maxTotalExposureSol} SOL`,
    `*Max open positions:* ${config.maxOpenPositions}`,
    `*Max trades/day:* ${config.maxTradesPerDay}`,
    `*Max slippage:* ${config.maxSlippageBps}bps`,
    `*Min balance:* ${config.minSolBalance} SOL`,
    `*Autonomous:* ${config.autonomousEnabled ? 'enabled' : 'disabled'}`,
    `*Trading allocation:* ${config.tradingAllocationSol} SOL`,
  ].join('\n');
}

export function formatStrategies(strategies: StrategyConfig[]): string {
  if (strategies.length === 0) return 'No strategies configured.';
  return strategies
    .map((s) => `${s.enabled ? '✅' : '⬜️'} *${s.name}*${s.autonomous ? ' (autonomous)' : ''} — size ${s.positionSizeSol} SOL, SL ${s.stopLossPercent}%`)
    .join('\n');
}

export function formatNewToken(token: TokenSnapshot): string {
  return `🆕 *NEW_TOKEN*\n${token.mint}\nCreator: ${token.creator}\nAge: ${Math.round(token.ageSeconds)}s`;
}

export function formatBuySignal(mint: string, signal: 'BUY' | 'STRONG_BUY', opportunityScore: number, riskScore: number): string {
  return `📈 *BUY_SIGNAL* (${signal})\n${mint}\nOpportunity: ${opportunityScore.toFixed(0)} · Risk: ${riskScore.toFixed(0)}`;
}

/** Per spec's BUY trade notification format: TOKEN, ENTRY, SIZE, SL, TP, SCORE, RISK. */
export function formatBuyExecuted(position: Position): string {
  const tp = position.takeProfitLevels.map((l) => `+${l.triggerPercent}%/${l.sellPercent}%`).join(', ') || 'none';
  return [
    '🟢 *BUY_EXECUTED*',
    `*Token:* ${position.tokenSymbol}`,
    `*Entry:* ${position.entryPrice.toPrecision(6)}`,
    `*Size:* ${position.entryValueSol} SOL`,
    `*SL:* ${position.stopLossPercent}% (${position.stopLossMode})`,
    `*TP:* ${tp}`,
    `*Score:* ${position.entryOpportunityScore ?? 'n/a'}`,
    `*Risk:* ${position.entryRiskScore ?? 'n/a'}`,
  ].join('\n');
}

/** Per spec's SELL trade notification format: TOKEN, ENTRY, EXIT, PNL, HOLD TIME, REASON. */
export function formatSellExecuted(position: Position, trade: Trade): string {
  const holdMin = trade.holdingTimeSeconds !== null ? (trade.holdingTimeSeconds / 60).toFixed(1) : 'n/a';
  return [
    '🔴 *SELL_EXECUTED*',
    `*Token:* ${position.tokenSymbol}`,
    `*Entry:* ${position.entryPrice.toPrecision(6)}`,
    `*Exit:* ${trade.price.toPrecision(6)}`,
    `*PnL:* ${trade.pnlSol !== null ? sol(trade.pnlSol) : 'n/a'} (${trade.pnlPercent?.toFixed(1) ?? 'n/a'}%)`,
    `*Hold time:* ${holdMin} min`,
    `*Reason:* ${trade.exitReason ?? 'n/a'}`,
  ].join('\n');
}

export function formatRiskReject(mint: string | null, sizeSol: number, result: RiskCheckResult): string {
  return `🚫 *RISK_REJECT*\n${mint ?? '(no mint)'}\nSize: ${sizeSol} SOL\nReasons: ${result.reasons.join(', ')}`;
}

export function formatDailyLossLimit(dailyLossSol: number, capSol: number): string {
  return `⛔️ *DAILY_LOSS_LIMIT*\nRealized loss today: ${dailyLossSol.toFixed(4)} SOL (cap ${capSol} SOL)`;
}

export function formatKillSwitch(active: boolean, reason: string | null): string {
  return active ? `🛑 *KILL_SWITCH* activated\n${reason ?? ''}` : `✅ *KILL_SWITCH* deactivated`;
}

export function formatRpcError(message: string, consecutiveFailures: number): string {
  return `⚠️ *RPC_ERROR*\n${message}\nConsecutive failures: ${consecutiveFailures}`;
}
