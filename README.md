# PUMP SCALPER PRO

Sniper + scalping system for **personal, self-directed** trading on Solana / Pump.fun.
Paper trading by default. Live trading requires an explicit environment flag
and an explicit in-app confirmation — see [Safety](#safety).

> **Status: under active development.** Being built phase by phase per the
> [Development Order](#development-order) below. This README is updated after
> every phase with exactly what exists and how to run it — nothing here is
> aspirational.

## Safety

- **`ENABLE_LIVE_TRADING=false` by default**, everywhere (local, Docker, prod).
  Live order execution is refused unless this is explicitly set to `true`.
- **Paper Trading is the default mode.** All engines (scoring, strategy, risk,
  TP/SL/trailing) run identically in paper mode — trades are simulated end to
  end (entry, slippage, fees, exits) and recorded like real trades.
- **The Risk Engine is a hard gatekeeper.** Every trade — manual, strategy,
  or autonomous — passes through it. It cannot be bypassed by any other
  component.
- **Private keys never touch the frontend or Telegram.** The wallet adapter
  abstraction only ever requests signatures from the user's own wallet
  (e.g. Phantom); the backend never holds a seed phrase.
- **Kill Switch** stops all new trading activity immediately but never
  auto-liquidates open positions — closing existing positions after a kill
  switch is always a separate, explicit user action.

## Architecture

```
apps/
  api/        Fastify + TypeScript backend: scanner, scoring, strategy,
              risk, execution, WebSocket hub, Telegram bot, REST API
  web/        Next.js + TypeScript PWA dashboard (mobile-first)
packages/
  shared/     Zod schemas + shared TypeScript types (API/WS contract)
  core/       Pure, unit-tested trading engines (scoring, risk, strategy,
              TP/SL/trailing, position manager, paper trading, analytics)
  solana/     Solana RPC/WebSocket connection, wallet adapter abstraction,
              Pump.fun on-chain + market-data adapters
```

Backend: Node.js, TypeScript, Fastify, WebSocket, PostgreSQL, Redis, Zod, Pino.
Frontend: Next.js, TypeScript, Tailwind, shadcn/ui, Framer Motion, Recharts.
Wallet: Solana Wallet Adapter (Phantom), Solana RPC/WebSocket.
Notifications: Telegram Bot API.
Deployment: Docker / Docker Compose (MacBook dev or VPS).

## Data sources — what's real, what's not built yet

Per explicit project rule: **no invented APIs.** Every external data source is
behind an adapter interface. This table is kept current every phase:

| Data | Source | Status |
|---|---|---|
| New token creation (mint, creator, block time) | Solana RPC `logsSubscribe` against the public Pump.fun program (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, confirmed via Solscan) — detects the Anchor `Instruction: Create` log line, then reads the confirmed transaction's `postTokenBalances` for the new mint and the fee payer as creator. Both are generically derivable from any Solana transaction; no pump.fun-specific IDL needed. | **Done (Phase 4)** |
| Token name, symbol, price, liquidity, volume, buy/sell counts | DexScreener public API (`GET /latest/dex/tokens/{mint}`, `api.dexscreener.com`, no key required, 300 req/min) — confirmed against docs.dexscreener.com. USD-denominated fields are converted to SOL using `priceNative/priceUsd` as the implied rate; liquidity is read directly from `liquidity.quote` (already SOL for SOL-quoted pairs). New tokens carry an explicit `PENDING_METADATA` sentinel until DexScreener indexes the pair (typically within seconds to a couple of minutes of first trade) — never a guessed name. | **Done (Phase 4)** |
| Bonding-curve reserves, exact market cap pre-graduation, name/symbol straight from the `Create` instruction | Requires decoding pump.fun's own (unofficial) Anchor IDL for the `Create` instruction/`CreateEvent`. Deliberately **not implemented** — see `PumpFunEventDecoder` in `packages/solana/src/adapters/pumpfunEventDecoder.ts` for why guessing the byte layout was rejected, and how to plug in a verified decoder yourself. | Adapter interface defined, not implemented |
| Unique buyer/seller wallet counts, holder count, distribution, creator holding % | **Not available from a free/no-key public API.** DexScreener gives buy/sell *transaction* counts (used for `buys5m`/`sells5m`) but not unique wallets or holder distribution. Getting these needs a paid indexer (Helius DAS, Birdeye, etc.) — these fields stay `null` until you wire one in, and any score/rule that depends on them treats `null` as "unknown, do not assume safe." | Not available; fields are `null` |
| Live trade execution / swap routing | Requires an on-chain DEX aggregator (e.g. Jupiter). Interface defined in `ExecutionEngine`; concrete live adapter ships in Phase 13, disabled by default. | Phase 13 |

## Database

Postgres schema, applied via a small built-in migration runner (no ORM —
plain SQL migrations in `apps/api/src/db/migrations/`, tracked in a
`schema_migrations` table).

Tables required by spec: `users`, `strategies`, `tokens`, `signals`,
`positions`, `trades`, `risk_events`, `system_events`, `wallets`.

Two tables were added beyond that list because the product cannot persist
its own operating state without them — documented here rather than added
silently:
- `risk_configs` — per-user Risk Engine limits (max position size, daily
  loss, exposure, open positions, trades/day, slippage, min balance,
  autonomous-mode limits). Phase 8 reads/writes this table; it has to live
  somewhere durable.
- `bot_state` — current bot status (`PAPER`/`READY`/`RUNNING`/`STOPPED`/
  `KILL_SWITCH`), trading mode, active strategy, and kill-switch state, so
  it survives an API restart instead of resetting to unknown.

Run migrations:
```bash
npm run migrate --workspace apps/api
```

Every repository under `apps/api/src/db/repositories/` is covered by real
integration tests (`apps/api/tests/db.integration.test.ts`) that run against
an actual Postgres instance — no mocked SQL. See
[Local Postgres/Redis for development](#local-postgresredis-for-development)
to set that up.

## Solana connection

`packages/solana` wraps `@solana/web3.js`:

- `createConnection()` — the shared `Connection`, configured with both
  `SOLANA_RPC_URL` and `SOLANA_WS_URL` so on-chain subscriptions
  (`logsSubscribe`, `accountSubscribe`, `programSubscribe` — used by the
  scanner in Phase 4) ride the same client.
- `RpcHealthMonitor` — polls `getSlot()` on an interval and emits
  `healthy` / `unhealthy` / `reconnected`, which is what will drive the
  `RPC_ERROR` Telegram alert (Phase 11) and `system_events` logging —
  `@solana/web3.js` reconnects its websocket internally, but silently, so
  something has to surface that to the user.
- `WalletAdapter` — the interface Phantom gets wired into in Phase 12
  (browser-only; see the security note in the source file for why the
  backend must never implement `signTransaction`/`sendTransaction`).
- `ReadOnlyWalletReader` — the backend's *only* wallet capability: SOL and
  SPL token balance lookups from a public key, no signing, no keys held.

## Real-time token scanner

`TokenScanner` (`apps/api/src/scanner/`) wires three pieces together:
1. `PumpFunTokenDiscovery` (packages/solana) — on-chain, real-time.
2. `DexScreenerAdapter` (packages/solana) — periodic enrichment sweep
   (every 15s by default) over mints still pending full metadata.
3. The `tokens` repository (Phase 2) — every discovery and every
   enrichment update is upserted immediately, so the `tokens` table is
   always the current best-known state.

Try it against live mainnet (needs a real `SOLANA_RPC_URL`/`SOLANA_WS_URL`
and a migrated database):
```bash
npx tsx apps/api/src/scanner/run.ts
```
This prints nothing until pump.fun has an actual new launch — the public
RPC endpoint in `.env.example` is heavily rate-limited; a dedicated
provider is recommended for anything beyond a quick smoke test. This
script has not been run against live mainnet traffic in this environment
(no assumption is being made that it has) — the discovery and enrichment
logic themselves are covered by 18 unit tests against realistic fixtures
(fake RPC log streams, fake DexScreener responses: 5 for the pump.fun
adapter, 8 for the DexScreener adapter, 5 for the TokenScanner
orchestrator), so correctness doesn't depend on catching a real launch
during a test run.

## Development Order

- [x] Phase 1 — Project architecture
- [x] Phase 2 — Database
- [x] Phase 3 — Solana connection
- [x] Phase 4 — Real-time token scanner
- [ ] Phase 5 — Scoring Engine
- [ ] Phase 6 — Paper Trading
- [ ] Phase 7 — Strategy Engine
- [ ] Phase 8 — Risk Engine
- [ ] Phase 9 — TP / SL / Trailing Stop
- [ ] Phase 10 — Dashboard
- [ ] Phase 11 — Telegram
- [ ] Phase 12 — Wallet Adapter
- [ ] Phase 13 — Live Execution Adapter
- [ ] Phase 14 — Security Audit
- [ ] Phase 15 — Production Deployment

## Getting started (current state)

```bash
npm install
npm run typecheck
npm test
```

`npm test` at the root runs the `@pump-scalper/shared` unit tests only,
unless a Postgres test database is reachable — see below to also run the
`apps/api` DB integration tests.

There is no runnable server yet — that lands in Phase 3 onward. Full
installation (MacBook, Docker, VPS), RPC/Telegram/wallet setup, and strategy
configuration docs are added as those phases complete.

### Local Postgres/Redis for development

```bash
# Debian/Ubuntu example — adjust for your OS, or use Docker (see Phase 15)
sudo service postgresql start
sudo service redis-server start
sudo -u postgres psql -c "CREATE ROLE pump_scalper LOGIN PASSWORD 'pump_scalper';"
sudo -u postgres createdb -O pump_scalper pump_scalper
sudo -u postgres createdb -O pump_scalper pump_scalper_test   # used only by tests

cp .env.example .env   # fill in DATABASE_URL etc.
npm run migrate --workspace apps/api

npm run test --workspace apps/api   # runs against pump_scalper_test automatically
```

## License

Personal-use project. Not audited. Trading is risky; live transactions can
result in loss of funds.
