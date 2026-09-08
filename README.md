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
| New token creation, bonding-curve state | Solana RPC `logsSubscribe`/`getAccountInfo` against the public Pump.fun program | Phase 4 |
| Liquidity, volume, buys/sells, price | DexScreener public API (`api.dexscreener.com`, no key required) | Phase 4 |
| Holder count / distribution, creator holding % | **Not available from a free/no-key public API today.** The adapter interface (`HolderDataProvider`) is defined; the concrete implementation requires a paid indexer (e.g. Helius DAS, Birdeye) — wire your own key when you have one. Until then these fields are `null` and any score/rule that depends on them treats `null` as "unknown, do not assume safe". | Phase 4 |
| Live trade execution / swap routing | Requires an on-chain DEX aggregator (e.g. Jupiter). Interface defined in `ExecutionEngine`; concrete live adapter ships in Phase 13, disabled by default. | Phase 13 |

## Development Order

- [x] Phase 1 — Project architecture
- [ ] Phase 2 — Database
- [ ] Phase 3 — Solana connection
- [ ] Phase 4 — Real-time token scanner
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

There is no runnable server yet — that lands in Phase 3 onward. Full
installation (MacBook, Docker, VPS), RPC/Telegram/wallet setup, and strategy
configuration docs are added as those phases complete.

## License

Personal-use project. Not audited. Trading is risky; live transactions can
result in loss of funds.
