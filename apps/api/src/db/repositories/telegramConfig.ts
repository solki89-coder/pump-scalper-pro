import { queryOne } from '../client.js';

export interface TelegramConfig {
  userId: string;
  botToken: string | null;
  chatId: string | null;
  enabled: boolean;
  updatedAt: string;
}

interface TelegramConfigRow {
  user_id: string;
  bot_token: string | null;
  chat_id: string | null;
  enabled: boolean;
  updated_at: Date;
}

function mapTelegramConfig(row: TelegramConfigRow): TelegramConfig {
  return {
    userId: row.user_id,
    botToken: row.bot_token,
    chatId: row.chat_id,
    enabled: row.enabled,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getTelegramConfig(userId: string): Promise<TelegramConfig | null> {
  const row = await queryOne<TelegramConfigRow>(`SELECT * FROM telegram_configs WHERE user_id = $1`, [userId]);
  return row ? mapTelegramConfig(row) : null;
}

/**
 * `botToken: undefined` leaves the stored token untouched (the settings
 * route never receives the real token back after first save, so it has
 * no way to resubmit it when the user only changes chatId/enabled —
 * `null` would be a way to explicitly clear it, `undefined` means "don't
 * touch this field").
 */
export async function upsertTelegramConfig(
  userId: string,
  fields: { botToken?: string | null; chatId: string | null; enabled: boolean },
): Promise<TelegramConfig> {
  const row = await queryOne<TelegramConfigRow>(
    `INSERT INTO telegram_configs (user_id, bot_token, chat_id, enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       bot_token = COALESCE($2, telegram_configs.bot_token),
       chat_id = $3,
       enabled = $4,
       updated_at = now()
     RETURNING *`,
    [userId, fields.botToken ?? null, fields.chatId, fields.enabled],
  );
  if (!row) throw new Error('upsertTelegramConfig: no row returned');
  return mapTelegramConfig(row);
}
