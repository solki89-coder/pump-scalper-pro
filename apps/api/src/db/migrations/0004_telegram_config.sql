-- Phase 16 (post-launch): Telegram bot token/chat id become dashboard-
-- editable settings instead of env-var-only. One row per operator, same
-- pattern as risk_configs/bot_state. bot_token is stored as-is (not
-- hashed — unlike a password, the app itself needs the plaintext back to
-- call the Telegram API), so treat this table's contents the same way
-- the .env file's TELEGRAM_BOT_TOKEN was already treated: a secret, not
-- exposed back to any API response (see routes/settings.ts).
CREATE TABLE telegram_configs (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bot_token   TEXT,
  chat_id     TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
