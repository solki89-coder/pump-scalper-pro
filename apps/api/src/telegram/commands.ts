import { computePnlAnalytics } from '@pump-scalper/core';
import { getOrCreateBotState, updateBotState } from '../db/repositories/botState.js';
import { listOpenPositions } from '../db/repositories/positions.js';
import { getRiskConfig } from '../db/repositories/riskConfig.js';
import { listStrategies } from '../db/repositories/strategies.js';
import { listRecentTokens } from '../db/repositories/tokens.js';
import { listTrades } from '../db/repositories/trades.js';
import { getVirtualSolBalance } from '../trading/paperBalance.js';
import { activateKillSwitch } from '../risk/killSwitch.js';
import * as fmt from './formatting.js';

export type Reply = (text: string) => Promise<void>;

const NO_OPERATOR = 'No operator account configured yet. Set ADMIN_EMAIL/ADMIN_PASSWORD and restart.';

/**
 * The actual command logic, independent of grammy — each function takes
 * the resolved operator userId (or null if none exists yet) and a plain
 * `reply` callback, so this is testable directly against the real
 * repositories without simulating a Telegram update.
 */
export const commands = {
  async status(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const state = await getOrCreateBotState(userId);
    const riskConfig = await getRiskConfig(userId);
    const balance = riskConfig ? await getVirtualSolBalance(userId, riskConfig.tradingAllocationSol) : 0;
    await reply(fmt.formatStatus(state, balance));
  },

  async pnl(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const trades = await listTrades(userId, 'ALL', 10_000);
    await reply(fmt.formatPnl(computePnlAnalytics(trades)));
  },

  async positions(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const positions = await listOpenPositions(userId);
    await reply(fmt.formatPositions(positions));
  },

  async tokens(_userId: string | null, reply: Reply): Promise<void> {
    const tokens = await listRecentTokens(10);
    await reply(fmt.formatTokens(tokens));
  },

  async start(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const state = await updateBotState(userId, { status: 'RUNNING' });
    await reply(`Bot status: ${state.status}`);
  },

  async stop(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const state = await updateBotState(userId, { status: 'STOPPED' });
    await reply(`Bot status: ${state.status}`);
  },

  async paper(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const state = await updateBotState(userId, { status: 'PAPER', mode: 'PAPER' });
    await reply(`Mode: ${state.mode}`);
  },

  async live(_userId: string | null, reply: Reply): Promise<void> {
    await reply(
      'Autonomous live trading is not offered by this system (Phase 13 scope decision — manual-only). ' +
        'Manual live trades require signing with your own wallet in the dashboard and cannot be placed from Telegram.',
    );
  },

  async risk(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const config = await getRiskConfig(userId);
    if (!config) return reply('No risk configuration set yet.');
    await reply(fmt.formatRiskConfig(config));
  },

  async strategy(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    const strategies = await listStrategies(userId);
    await reply(fmt.formatStrategies(strategies));
  },

  async kill(userId: string | null, reply: Reply): Promise<void> {
    if (!userId) return reply(NO_OPERATOR);
    await activateKillSwitch(userId, 'Activated via Telegram /kill');
    await reply('🛑 Kill switch activated. Existing positions were left untouched.');
  },
};
