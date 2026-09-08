import type { BotState } from '@pump-scalper/shared';
import { queryOne } from '../client.js';

interface BotStateRow {
  user_id: string;
  status: BotState['status'];
  mode: BotState['mode'];
  active_strategy_id: string | null;
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  updated_at: Date;
}

function mapBotState(row: BotStateRow): BotState {
  return {
    userId: row.user_id,
    status: row.status,
    mode: row.mode,
    activeStrategyId: row.active_strategy_id,
    killSwitchActive: row.kill_switch_active,
    killSwitchReason: row.kill_switch_reason,
    updatedAt: row.updated_at.toISOString(),
  };
}

const DEFAULT_STATE: Omit<BotState, 'userId' | 'updatedAt'> = {
  status: 'PAPER',
  mode: 'PAPER',
  activeStrategyId: null,
  killSwitchActive: false,
  killSwitchReason: null,
};

export async function getOrCreateBotState(userId: string): Promise<BotState> {
  const existing = await queryOne<BotStateRow>(`SELECT * FROM bot_state WHERE user_id = $1`, [userId]);
  if (existing) return mapBotState(existing);
  const row = await queryOne<BotStateRow>(
    `INSERT INTO bot_state (user_id, status, mode, active_strategy_id, kill_switch_active, kill_switch_reason)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      userId,
      DEFAULT_STATE.status,
      DEFAULT_STATE.mode,
      DEFAULT_STATE.activeStrategyId,
      DEFAULT_STATE.killSwitchActive,
      DEFAULT_STATE.killSwitchReason,
    ],
  );
  if (!row) throw new Error('getOrCreateBotState: insert returned no row');
  return mapBotState(row);
}

export async function updateBotState(
  userId: string,
  patch: Partial<Pick<BotState, 'status' | 'mode' | 'activeStrategyId' | 'killSwitchActive' | 'killSwitchReason'>>,
): Promise<BotState> {
  const current = await getOrCreateBotState(userId);
  const merged = { ...current, ...patch };
  const row = await queryOne<BotStateRow>(
    `UPDATE bot_state SET status = $2, mode = $3, active_strategy_id = $4,
       kill_switch_active = $5, kill_switch_reason = $6, updated_at = now()
     WHERE user_id = $1 RETURNING *`,
    [userId, merged.status, merged.mode, merged.activeStrategyId, merged.killSwitchActive, merged.killSwitchReason],
  );
  if (!row) throw new Error('updateBotState: no row returned');
  return mapBotState(row);
}
