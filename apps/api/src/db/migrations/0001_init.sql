-- PUMP SCALPER PRO — initial schema
-- Tables required by spec: users, strategies, tokens, signals, positions,
-- trades, risk_events, system_events, wallets.
-- Two tables are added beyond that list because the product cannot function
-- without persisting them across restarts: `risk_configs` (per-user Risk
-- Engine limits) and `bot_state` (current PAPER/READY/RUNNING/STOPPED/
-- KILL_SWITCH status + active strategy). Both are documented here and in
-- README.md rather than silently added.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label                  TEXT NOT NULL DEFAULT 'main' CHECK (label IN ('main', 'trading')),
  public_key             TEXT,
  connected              BOOLEAN NOT NULL DEFAULT false,
  trading_allocation_sol NUMERIC(20, 9) NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);

CREATE TABLE risk_configs (
  user_id                       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_position_size_sol         NUMERIC(20, 9) NOT NULL,
  max_daily_loss_sol            NUMERIC(20, 9) NOT NULL,
  max_total_exposure_sol        NUMERIC(20, 9) NOT NULL,
  max_open_positions            INTEGER NOT NULL,
  max_trades_per_day            INTEGER NOT NULL,
  max_slippage_bps              INTEGER NOT NULL,
  min_sol_balance                NUMERIC(20, 9) NOT NULL,
  autonomous_enabled            BOOLEAN NOT NULL DEFAULT false,
  autonomous_max_position_sol   NUMERIC(20, 9),
  autonomous_max_daily_loss_sol NUMERIC(20, 9),
  autonomous_max_trades         INTEGER,
  trading_allocation_sol        NUMERIC(20, 9) NOT NULL DEFAULT 0,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bot_state (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'PAPER' CHECK (status IN ('PAPER', 'READY', 'RUNNING', 'STOPPED', 'KILL_SWITCH')),
  mode                TEXT NOT NULL DEFAULT 'PAPER' CHECK (mode IN ('PAPER', 'LIVE')),
  active_strategy_id  UUID,
  kill_switch_active  BOOLEAN NOT NULL DEFAULT false,
  kill_switch_reason  TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE strategies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  autonomous  BOOLEAN NOT NULL DEFAULT false,
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_strategies_user ON strategies(user_id);

ALTER TABLE bot_state
  ADD CONSTRAINT fk_bot_state_strategy FOREIGN KEY (active_strategy_id) REFERENCES strategies(id) ON DELETE SET NULL;

CREATE TABLE tokens (
  mint                              TEXT PRIMARY KEY,
  name                              TEXT NOT NULL,
  symbol                            TEXT NOT NULL,
  creator                           TEXT NOT NULL,
  first_seen_at                     TIMESTAMPTZ NOT NULL,
  price_sol                         NUMERIC(30, 15) NOT NULL DEFAULT 0,
  market_cap_sol                    NUMERIC(20, 9),
  liquidity_sol                     NUMERIC(20, 9),
  volume_sol_5m                     NUMERIC(20, 9),
  buys_5m                           INTEGER,
  sells_5m                          INTEGER,
  unique_buyers_5m                  INTEGER,
  unique_sellers_5m                 INTEGER,
  holders                           INTEGER,
  creator_holding_percent           NUMERIC(5, 2),
  top_holder_concentration_percent  NUMERIC(5, 2),
  bonding_curve_status              TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (bonding_curve_status IN ('ACTIVE', 'GRADUATING', 'GRADUATED', 'UNKNOWN')),
  graduation_status                 TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (graduation_status IN ('NOT_GRADUATED', 'GRADUATED', 'UNKNOWN')),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mint         TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  strategy_id  UUID REFERENCES strategies(id) ON DELETE SET NULL,
  signal       TEXT NOT NULL CHECK (signal IN ('STRONG_BUY', 'BUY', 'WATCH', 'WAIT', 'REJECT', 'SELL')),
  reason       TEXT NOT NULL DEFAULT '',
  scores       JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_signals_mint_time ON signals(mint, created_at DESC);

CREATE TABLE positions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id              UUID REFERENCES strategies(id) ON DELETE SET NULL,
  mode                     TEXT NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
  status                   TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  mint                     TEXT NOT NULL REFERENCES tokens(mint),
  token_name               TEXT NOT NULL,
  token_symbol             TEXT NOT NULL,
  entry_price              NUMERIC(30, 15) NOT NULL,
  current_price            NUMERIC(30, 15) NOT NULL,
  highest_price            NUMERIC(30, 15) NOT NULL,
  quantity                 NUMERIC(30, 9) NOT NULL,
  entry_value_sol          NUMERIC(20, 9) NOT NULL,
  current_value_sol        NUMERIC(20, 9) NOT NULL,
  unrealized_pnl_sol       NUMERIC(20, 9) NOT NULL DEFAULT 0,
  unrealized_pnl_percent   NUMERIC(10, 4) NOT NULL DEFAULT 0,
  realized_pnl_sol         NUMERIC(20, 9) NOT NULL DEFAULT 0,
  stop_loss_percent        NUMERIC(10, 4) NOT NULL,
  stop_loss_price          NUMERIC(30, 15) NOT NULL,
  take_profit_levels       JSONB NOT NULL DEFAULT '[]',
  trailing_stop_percent    NUMERIC(10, 4),
  trailing_stop_price      NUMERIC(30, 15),
  entry_opportunity_score  NUMERIC(5, 2),
  entry_risk_score         NUMERIC(5, 2),
  entry_time               TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_positions_user_status ON positions(user_id, status);
CREATE INDEX idx_positions_mint ON positions(mint);

CREATE TABLE trades (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id              UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  strategy_id              UUID REFERENCES strategies(id) ON DELETE SET NULL,
  mode                     TEXT NOT NULL CHECK (mode IN ('PAPER', 'LIVE')),
  mint                     TEXT NOT NULL REFERENCES tokens(mint),
  token_name               TEXT NOT NULL,
  token_symbol             TEXT NOT NULL,
  side                     TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  price                    NUMERIC(30, 15) NOT NULL,
  quantity                 NUMERIC(30, 9) NOT NULL,
  size_sol                 NUMERIC(20, 9) NOT NULL,
  fees_sol                 NUMERIC(20, 9) NOT NULL DEFAULT 0,
  slippage_bps             INTEGER NOT NULL DEFAULT 0,
  pnl_sol                  NUMERIC(20, 9),
  pnl_percent              NUMERIC(10, 4),
  exit_reason              TEXT CHECK (exit_reason IN ('TAKE_PROFIT', 'STOP_LOSS', 'TRAILING_STOP', 'MAX_HOLDING_TIME', 'MANUAL', 'SIGNAL_SELL', 'KILL_SWITCH')),
  holding_time_seconds     INTEGER,
  entry_opportunity_score  NUMERIC(5, 2),
  entry_risk_score         NUMERIC(5, 2),
  tx_signature             TEXT,
  executed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trades_user_time ON trades(user_id, executed_at DESC);
CREATE INDEX idx_trades_position ON trades(position_id);

CREATE TABLE risk_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mint               TEXT,
  strategy_id        UUID REFERENCES strategies(id) ON DELETE SET NULL,
  reasons            TEXT[] NOT NULL,
  attempted_size_sol NUMERIC(20, 9),
  details            JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_events_user_time ON risk_events(user_id, created_at DESC);

CREATE TABLE system_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_system_events_user_time ON system_events(user_id, created_at DESC);
