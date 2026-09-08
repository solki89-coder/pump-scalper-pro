import { loadConfig } from '../config.js';
import { getOrCreateBotState } from '../db/repositories/botState.js';
import { countOpenPositions, sumOpenExposureSol } from '../db/repositories/positions.js';
import { createRiskEvent } from '../db/repositories/riskEvents.js';
import { countTradesToday, sumRealizedPnlSince } from '../db/repositories/trades.js';
import { getTelegramAlerts } from '../telegram/index.js';
import { evaluateTrade as evaluateTradeCore, type RiskGatePorts, type TradeRequest } from './riskGate.js';

export { activateKillSwitch, deactivateKillSwitch } from './killSwitch.js';
export type { TradeRequest } from './riskGate.js';

const realPorts: RiskGatePorts = {
  getBotState: (userId) => getOrCreateBotState(userId),
  countOpenPositions,
  sumOpenExposureSol,
  countTradesToday,
  sumRealizedPnlSince,
  recordRiskEvent: async (event) => {
    await createRiskEvent(event);
  },
  isLiveTradingEnabled: () => loadConfig().ENABLE_LIVE_TRADING,
  get alerts() {
    return getTelegramAlerts();
  },
};

/** Wires the real Postgres-backed ports into evaluateTrade(). */
export function evaluateTrade(request: TradeRequest, riskConfig: Parameters<typeof evaluateTradeCore>[1]) {
  return evaluateTradeCore(request, riskConfig, realPorts);
}
