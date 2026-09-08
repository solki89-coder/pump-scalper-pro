import type { BotState } from '@pump-scalper/shared';
import { updateBotState } from '../db/repositories/botState.js';
import { createSystemEvent } from '../db/repositories/systemEvents.js';

/**
 * STOP ALL TRADING. Per spec, this:
 *   - flips bot_state so the Risk Engine rejects every new trade
 *     (KILL_SWITCH_ACTIVE, checked first, ahead of every other rule)
 *   - is picked up by the scanner/autonomous loop's own status check before
 *     their next cycle (they poll bot_state; see TokenScanner/autonomous
 *     engine — neither starts a new cycle while status is KILL_SWITCH)
 *   - does NOT touch any existing open position. Liquidating them is
 *     always a separate, explicit user action — never automatic here.
 * The Telegram alert this is supposed to trigger is wired in Phase 11;
 * a system_event is recorded now so the audit trail exists regardless.
 */
export async function activateKillSwitch(userId: string, reason: string): Promise<BotState> {
  const state = await updateBotState(userId, { status: 'KILL_SWITCH', killSwitchActive: true, killSwitchReason: reason });
  await createSystemEvent({ userId, type: 'KILL_SWITCH_ON', details: { reason } });
  return state;
}

export async function deactivateKillSwitch(userId: string): Promise<BotState> {
  const state = await updateBotState(userId, { status: 'STOPPED', killSwitchActive: false, killSwitchReason: null });
  await createSystemEvent({ userId, type: 'KILL_SWITCH_OFF', details: {} });
  return state;
}
