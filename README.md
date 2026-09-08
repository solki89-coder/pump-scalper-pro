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

## Scoring Engine

`packages/core/src/scoring.ts` — pure, synchronous, fully unit-tested
functions, no DB or network access. `scoreToken(snapshot, weights?,
thresholds?)` returns all 7 spec scores (`opportunityScore`, `riskScore`,
`momentumScore`, `liquidityScore`, `buyPressureScore`, `holderScore`,
`creatorRiskScore`), each 0–100.

Two things worth knowing before trusting these numbers:
- **These are tunable heuristics, not ground truth.** Every threshold
  (target liquidity, target volume, target holder count) lives in
  `ScoringThresholds` and every sub-score's weight in the final
  `opportunityScore` lives in `ScoreWeights` (`momentumWeight`,
  `liquidityWeight`, `volumeWeight`, `buyPressureWeight`, `holderWeight`,
  `creatorRiskWeight`) — both overridable, both meant to be tuned via the
  Strategy Builder (Phase 7/10).
- **Missing data is never scored as safe.** A single `TokenSnapshot` has no
  price/volume history, so `momentumScore` approximates trend from current
  activity discounted by token age; and every score that depends on a
  `null` field (holder distribution, creator holding % — see the
  data-source table above) resolves to a conservative, not neutral, value.
  A token DexScreener hasn't indexed yet scores low, not lucky.

## Execution Engine & Paper Trading

`ExecutionEngine` (`packages/core/src/execution/types.ts`) is the interface
every trade — manual, strategy, or autonomous — goes through:
`quoteBuy`/`quoteSell`/`executeBuy`/`executeSell`/`estimateFees`/`estimateSlippage`.
Paper and live (Phase 13) both implement it, so trading logic never has to
know which mode it's running in.

`PaperExecutionEngine` — today's only implementation — simulates the full
fill: a linear price-impact slippage model (`size / liquidity`, deliberately
simple and documented as a heuristic — a bonding curve's real impact is
convex, not linear), pump.fun's documented 1% platform fee plus a flat
network-fee estimate, and jittered slippage within the quoted bound.
**It never sends a transaction** — `txSignature` is always `null` in paper
mode, per spec.

`PaperTradingService` (`apps/api/src/trading/`) drives `openPosition()`/
`closePosition()` through the execution engine and persists exactly through
the Phase 2 `positions`/`trades` repositories, tagged `mode: 'PAPER'` —
every paper trade is saved as if it were real, per spec. Multi-level
take-profit / stop-loss / trailing-stop *decision* logic (when to trigger a
sell, and for how much) is Phase 9; this phase provides the simulated
execution + persistence those decisions will call into.

Tested with 17 unit tests (11 for `PaperExecutionEngine`, 6 for
`PaperTradingService` against fakes) plus 1 end-to-end integration test
against real Postgres (open → close → verify both rows and PnL).

## Strategy Engine & Signal Engine

`packages/core/src/strategy/` — pure, synchronous, fully tested:

- **`matchesStrategyFilters`** — the Strategy Builder's discovery filters
  (token age, liquidity, volume, market cap, buy/sell ratio, unique
  buyers, holder concentration cap, creator holding cap). A filter the
  strategy leaves unset is skipped; a filter the strategy *does* set is
  failed by missing data, never passed by default.
- **`evaluateSignal`** — the Signal Engine: `STRONG_BUY` / `BUY` / `WATCH` /
  `WAIT` / `REJECT`, exactly per spec's worked example (opportunity/risk/
  momentum/liquidity/buy-pressure thresholds), gated first by the
  discovery filters above and by the `PENDING_METADATA` sentinel (→
  `WAIT`, never a guess). **A `BUY`/`STRONG_BUY` signal is a candidate
  only** — nothing here checks risk limits, balances, or open positions;
  every candidate still has to clear the Risk Engine (Phase 8) before
  anything executes.
- **`evaluateHoldSignal`** — a coarse `SELL` early-warning for an open
  position whose risk score has deteriorated well past the strategy's own
  cap. This is not a substitute for the price-triggered TP/SL/trailing
  engine (Phase 9).
- **`rankCandidates`** — the Autonomous Engine's RANK step: orders
  `BUY`/`STRONG_BUY` candidates (`STRONG_BUY` first, then by
  `opportunityScore`, ties broken by lower `riskScore`). Pure ranking —
  it does not decide whether the top candidate may actually be bought.

**What's intentionally not built yet:** the full Autonomous Engine loop
(SCAN → ANALYZE → RANK → WAIT/BUY/SELL, continuously tying the scanner,
scoring, strategy, and execution together) is not wired up as a running
service in this phase. Per spec, "the autonomous engine never bypasses the
Risk Engine" — assembling that loop before the Risk Engine (Phase 8) exists
to gate it would mean either leaving it unenforced or building something
that looks wired but isn't actually safe. It's assembled in Phase 8 once
the gatekeeper exists.

23 unit tests (9 filters, 9 signal, 5 ranking) — all pure, no DB/network.

## Risk Engine & Kill Switch

**The gatekeeper. Nothing bypasses it.** `checkTrade()`
(`packages/core/src/risk/riskEngine.ts`) is a pure function checking every
spec-required limit — `MAX_POSITION_SIZE`, `MAX_DAILY_LOSS`,
`MAX_TOTAL_EXPOSURE`, `MAX_OPEN_POSITIONS`, `MAX_TRADES_PER_DAY`,
`MAX_SLIPPAGE`, `MIN_SOL_BALANCE` — plus `TRADING_ALLOCATION_EXCEEDED`
(separate Trading Wallet cap), `KILL_SWITCH_ACTIVE` and
`LIVE_TRADING_DISABLED` (checked first, ahead of everything else), and the
four `AUTONOMOUS_*` limits for autonomous trades specifically. It never
short-circuits on the first failure — a rejected trade reports *every*
reason it failed, not just one.

`evaluateTrade()` (`apps/api/src/risk/riskGate.ts`) is the DB-wired version
every real code path calls: it gathers live state (open positions,
exposure, trades today, realized daily PnL, kill-switch state) and hands it
to `checkTrade()`. Every rejection is persisted as a `risk_event` — the
spec's audit-log requirement, not just an in-memory decision.

**Kill Switch** (`apps/api/src/risk/killSwitch.ts`): flips `bot_state` to
`KILL_SWITCH`, which `checkTrade()` rejects ahead of every other rule, and
logs a `system_event`. It **never touches open positions** — closing them
is always a separate, explicit action, exactly per spec. (The Telegram
alert this is supposed to fire lands in Phase 11; the audit trail exists
regardless.)

**Autonomous Engine** (`apps/api/src/autonomous/autonomousEngine.ts`) —
assembled now that the gatekeeper exists, closing the loop promised in
Phase 7: SCAN (candidate tokens) → ANALYZE (score) → RANK → for each
ranked candidate, `evaluateTrade()` → only on approval, `openPaperPosition()`.
Two hard stops before any of that: kill switch active does nothing at all,
and **LIVE mode also does nothing** — autonomous live trading needs the
live execution engine (Phase 13), so this refuses outright rather than
quietly trading paper under a "LIVE" label.

45 tests: 19 for `checkTrade()`, 6 for `evaluateTrade()` (fakes), 7 for the
autonomous engine (fakes), 2 kill-switch + 1 paper-trading end-to-end
integration tests against real Postgres. **131 tests pass across the whole
monorepo as of this phase.**

## TP / SL / Trailing Stop & Position Manager

`packages/core/src/positions/` — pure, fully tested:

- **`evaluatePositionExit`** — the one decision function the runtime calls
  on every price tick, checked in this exact priority order: `STOP_LOSS` →
  `TRAILING_STOP` (only once armed — i.e. `highestPrice` has actually moved
  above entry) → `TAKE_PROFIT` (the lowest-index unexecuted level whose
  target is reached; a price spike that jumps two levels still triggers
  them one per subsequent tick, never both at once) → `MAX_HOLDING_TIME`.
- **`recalculateStopLossPrice`** — `FIXED` never moves from entry;
  `DYNAMIC` ratchets up with the position's highest price and never loosens
  back down. The spec names both modes without defining DYNAMIC's exact
  formula — this is this project's documented interpretation, not a
  claimed industry standard.
- **`computeTrailingStopPrice`** — `highestPrice - trailingPercentage`,
  exactly per spec.
- **`computePositionPriceUpdate`** — the Position Manager's real-time
  recompute: `highestPrice` ratchet, `currentValueSol`/`unrealizedPnlSol`/
  `unrealizedPnlPercent`, and both the stop-loss and trailing-stop prices,
  from a single new price tick.

**Multi-level take-profit** required a schema change: `takeProfitLevels`'
`sellPercent` values are always relative to the position's *original*
quantity (spec's TP1/TP2/TP3 example sums to ≤100%), not the shrinking
remaining quantity after earlier partial sells — so `Position` now tracks
`originalQuantity` (fixed at entry) separately from `quantity` (remaining,
unsold). `PaperTradingService.sellPartial()` (`apps/api/src/trading/`)
executes and persists exactly that: sells the requested amount (capped at
what's actually remaining), marks the triggered level executed, and closes
the position outright once nothing is left — all through the same
execution engine and `positions`/`trades` repositories as a full close.

`monitorPositionTick` (`apps/api/src/trading/positionMonitor.ts`) is the
runtime glue: persist the price update → `evaluatePositionExit` → on a
trigger, `sellPartial` (take-profit) or `closePosition` (everything else)
via the new `TradingService` interface (`PaperTradingService` implements
it; a future `LiveTradingService`, Phase 13, will too — callers depend on
the interface, never the concrete paper class). One documented decision:
an exit never re-runs the entry-oriented Risk Engine (including
`KILL_SWITCH_ACTIVE`) — the kill switch stops *new* positions, never
existing ones, and blocking a stop-loss during a kill switch would leave
capital undefended, which defeats the point of both mechanisms. The
execution engine's own slippage/balance checks still apply to every exit
regardless, per spec's stop-loss requirement.

29 new tests (15 `evaluatePositionExit`, 5 `computePositionPriceUpdate`, 5
`sellPartial`, 7 `monitorPositionTick`, on top of the existing paper
trading tests) — **163 tests pass across the whole monorepo.**

## Dashboard

`apps/web` — Next.js (App Router) PWA, mobile-first, dark trading-terminal
theme, talking to the Phase 10 backend over REST + one shared WebSocket.

**Scope note:** built as a reduced dashboard by explicit choice during
development, not the full 8-screen set (`/dashboard /scanner /positions
/strategies /trades /analytics /risk /settings`) originally scoped. What
exists: `/login` and one `/dashboard` screen carrying everything the spec's
"MAIN DASHBOARD" section lists — Portfolio (SOL Balance, Daily PnL, Total
PnL), Open Positions, Trades Today, Win Rate, Max Drawdown, Bot Status
badge, Start/Stop/Paper/Live/Kill Switch controls, a live cumulative-PnL
chart (Recharts), and the open-positions list — all updating in real time
over WebSocket, not polling. The other seven screens (Scanner, Strategies
builder, Trade History table, Risk config, Settings) are **not built** —
their REST endpoints exist and are tested (see below), there's just no UI
for them yet.

- **shadcn/ui**: hand-authored `Button`/`Card`/`Badge` components in
  shadcn's own visual language (Tailwind + `clsx`/`tailwind-merge`) — this
  matches how shadcn/ui actually works (components are copied into the
  project, not installed as a package), not a shortcut around it.
- **Auth**: Bearer token in `localStorage`, not the API's httpOnly-cookie +
  CSRF flow (which the backend supports and the login response still sets
  up, for future clients). A JWT in `localStorage` is readable by any
  script on the page — a real tradeoff, chosen to keep this reduced
  frontend simple, and one Phase 14's security audit should revisit.
- **PWA**: installable (`manifest.json`, mobile viewport, standalone
  display) with a placeholder SVG icon. No service worker / offline
  caching — a live trading dashboard showing stale cached data offline
  would be actively misleading, so that was left out rather than faked.

Verified in a real browser during development (Playwright, mobile
viewport), not just built: login → dashboard → live WebSocket updates →
Kill Switch button (with confirmation) flips the status badge in place →
Live Mode button surfaces the backend's real 501 refusal. That pass also
caught and fixed two real bugs no unit test had covered — cross-origin
`fetch` needs `credentials: 'include'` to both send and store the login
cookie the WebSocket handshake depends on, and a bodyless POST (Start/
Stop/Kill Switch) was being sent with `Content-Type: application/json`
and no body, which Fastify's default JSON parser rejects; the server's
content-type parser was made lenient to accept `{}` for those instead of
only patching the client.

## Telegram Bot & the runtime loop

`apps/api/src/telegram/` — all 11 spec commands (`/status /pnl /positions
/tokens /start /stop /paper /live /risk /strategy /kill`) and all 11 alert
types (`NEW_TOKEN BUY_SIGNAL BUY_EXECUTED SELL_EXECUTED TAKE_PROFIT
STOP_LOSS TRAILING_STOP RISK_REJECT DAILY_LOSS_LIMIT KILL_SWITCH
RPC_ERROR`). `/live` mirrors the API's own refusal — not implemented
until Phase 13. Every command is gated to the configured `TELEGRAM_CHAT_ID`
— the bot token alone is never sufficient to control trading. Command
logic (`telegram/commands.ts`) is decoupled from grammy itself, so it's
tested directly against real repositories, not by simulating Telegram
updates.

Alerts are wired at the single choke points that already exist for each
event — the Risk Engine (`riskGate.ts`, covering RISK_REJECT and
DAILY_LOSS_LIMIT for every caller: manual, autonomous, all of them), the
kill switch route, the token scanner's discovery handler, the paper
trading routes/position monitor (BUY_EXECUTED/SELL_EXECUTED, the latter's
message body naming the exact exit reason — TAKE_PROFIT/STOP_LOSS/
TRAILING_STOP/MAX_HOLDING_TIME/MANUAL), and the autonomous engine
(BUY_SIGNAL ahead of the risk gate). `TELEGRAM_BOT_TOKEN` unset ⇒ every
alert call is a no-op (`NoopTelegramAlerts`) — exactly "leave empty to
disable", not a half-working integration.

**This phase also closed a real gap**: through Phase 10, nothing actually
*ran* the scanner, position monitoring, or autonomous engine outside of
manual test scripts — `apps/api/src/server.ts`'s `main()` only ever
answered HTTP requests. `apps/api/src/loop.ts` now starts, on boot: the
token scanner, an `RpcHealthMonitor` (→ `RPC_ERROR` alert after 3
consecutive failures), a position-monitoring poll (every 10s, every open
position, every user — runs regardless of kill-switch/bot status, same
reasoning as `positionMonitor.ts`), and an autonomous-trading poll (every
15s, gated on `bot_state.status === 'RUNNING'`, same PAPER-only /
kill-switch refusal as `runAutonomousCycle` itself). Verified booting for
real: it starts cleanly, and when the sandbox's network policy blocked the
Solana RPC host, the health monitor caught and logged it instead of
crashing the process — the failure path was exercised for real, not just
unit-tested.

21 new tests (8 formatting, 6 command-integration against real Postgres,
plus the existing suites unaffected by the alert wiring since it's all
optional/no-op by default). **208 tests pass across the whole monorepo.**

## Wallet Adapter (Phantom)

`apps/web/src/lib/wallet/` wires Solana's official `@solana/wallet-adapter-react`
(+ `-react-ui`, `-phantom`) into the dashboard, implementing the
`WalletAdapter` interface Phase 3 defined in `packages/solana` — the same
interface a future non-web client could implement too.
`WalletConnectButton` connects Phantom, reads the SOL balance directly
from chain (read-only), and syncs only the **public** key to the backend
(`POST /api/wallet/connect`) — never a private key or seed phrase, per
`packages/solana/src/walletAdapter.ts`'s security rules. That's not a
policy this code follows; it's structurally true, because
`signTransaction`/`sendTransaction` delegate straight to the Phantom
extension itself, which this app's code never has visibility into.

A real bug turned up wiring this and testing it in an actual browser: the
naive `select(walletName)` → `connect()` pattern races React's own state
update and throws `WalletNotSelectedError`, because `connect()` runs
before the just-selected wallet has landed in state. Fixed by connecting
the specific adapter directly and reading its `publicKey` off the adapter
instance (set synchronously by its own `connect()`) instead of the
context's — sidesteps the render-timing gap entirely; `useWallet()`'s own
`connected`/`publicKey` still update shortly after for the UI's re-render,
via the adapter's `connect` event.

Also required splitting `@pump-scalper/solana` into a browser-safe entry
(`.`: connection, lamports, the wallet adapter interface, the read-only
balance reader, the DexScreener adapter) and a server-only one (`./server`:
`RpcHealthMonitor`, the pump.fun on-chain discovery adapter) — both use
Node's `EventEmitter`, which a frontend bundle has no business pulling in
(and webpack won't polyfill by default). `apps/api` imports from
`@pump-scalper/solana/server` for those two; nothing else changed.

**Verified in a real browser** (Playwright) without a Phantom extension
installed (this sandbox has none) — the honest limit of what could be
checked here: the button renders, clicking it fails gracefully with a
visible "Failed to connect wallet" message instead of crashing the page or
throwing to the console, which is exactly the code path that succeeds once
a real Phantom extension is present. The actual approve-in-Phantom flow
needs a real browser + extension to verify beyond that; do so before
relying on this for anything Phase 13 wires up.

## Live Execution Adapter

**Scope decision, made explicitly with the user before building this
phase: manual LIVE trades only, signed by the user's own connected
Phantom wallet. Autonomous trading never goes LIVE** — there is no way to
get per-trade human approval on an unattended loop, and pretending
otherwise (e.g. a server-held signing key for the autonomous engine) was
rejected as a materially different, riskier trust model than everything
else in this codebase. `runAutonomousCycle` still refuses outright in
LIVE mode (Phase 8); nothing in this phase changes that.

**Why Jupiter, not pump.fun's own instructions**: building a live buy/sell
against pump.fun's bonding curve directly would mean hand-decoding their
(unofficial, unverified) instruction format — exactly the gap
`packages/solana/src/adapters/pumpfunEventDecoder.ts` documents and
refuses to fill with a guess. Verified instead (via search, since this
sandbox couldn't fetch Jupiter's docs directly) that Jupiter's aggregator
routes pump.fun trades directly, bonding-curve phase included, per their
own integration announcements — so `JupiterSwapAdapter`
(`apps/api/src/execution/`) uses Jupiter's public quote/swap API as the
execution backend for both pre- and post-graduation tokens, without this
project inventing pump.fun's wire format itself. `JUPITER_API_BASE` is
configurable and flagged for verification against dev.jup.ag before real
use — Jupiter has changed their public endpoint before.

**The flow is two calls, not one**, because signing has to happen in the
browser:
1. `POST /api/execution/quote` — risk-gated (same `evaluateTrade()` every
   other trade goes through; `mode: 'LIVE'` requires `ENABLE_LIVE_TRADING=true`,
   checked here independently of `bot_state.mode`), returns a Jupiter
   quote plus an **unsigned** transaction for the connected wallet to sign
   via `useWalletAdapter()` (Phase 12).
2. `POST /api/execution/confirm` — called after the browser has signed and
   broadcast it. **Never trusts the request body for price, quantity, or
   fees** — `SolanaTransactionVerifier` reads the actual confirmed
   transaction's balance changes (`preBalances`/`postBalances`,
   `pre`/`postTokenBalances`) and only records a `Position`/`Trade`
   (`mode: 'LIVE'`) from what verifiably happened on-chain. A missing,
   unconfirmed, or failed transaction is refused (`TransactionNotConfirmedError`,
   HTTP 409), not silently recorded from what the client claims occurred.

**What's not built**: no frontend UI wires this flow together yet (no
"Buy Live" button) — consistent with the Phase 10 scope note, the reduced
dashboard has no manual-buy UI for PAPER either. The backend capability is
real, complete, and tested; a trading UI on top of it is future work.

**Test coverage, and its honest limit**: `JupiterSwapAdapter`,
`SolanaTransactionVerifier`, and `LiveTradeRecorder` are fully unit-tested
(26 tests) against fakes — no live network in the suite. The routes
themselves are tested for the parts that don't require live network
(auth, `ENABLE_LIVE_TRADING=false` refusal, validation) — 4 tests. The
actual quote/confirm success paths call real Jupiter + Solana RPC inline
in the route handlers and were **not** exercised end-to-end in this
sandboxed environment (mainnet RPC is blocked here, same as Phase 4/11's
scanner) — verify with a real RPC endpoint, `ENABLE_LIVE_TRADING=true`,
and a small real balance before trusting this with meaningful funds.

## Security Audit (Phase 14)

A pass over the whole system looking specifically for things that could go
wrong with real money or real credentials, not new features. Every finding
below was either fixed (and covered by a test where the fix is
network-independent) or is listed as accepted with the reasoning for why.

**Fixed:**

- **Critical dependency vulnerability**: `@fastify/jwt@9.1.0` pulled in a
  `fast-jwt` version with several published CVEs, including a JWT auth
  bypass via an empty/weak HMAC secret
  ([GHSA-gmvf-9v4p-v8jc](https://github.com/advisories/GHSA-gmvf-9v4p-v8jc)).
  Upgraded to `@fastify/jwt@10.2.2` — `npm audit` on production
  dependencies drops from 24 vulnerabilities (2 critical) to 22 (0
  critical). Verified with the full test suite and a real login flow
  after upgrading, not just a version bump.
- **`JWT_SECRET` had no strength floor**: `min(1)` would let the server
  boot with a one-character HMAC secret — trivially brute-forceable
  offline. Raised to `min(32)` (matches the `.env.example` guidance,
  which already said "32+ byte secret").
- **Dashboard held its JWT in `localStorage`**: readable by any script on
  the page (XSS risk), flagged explicitly by name in Phase 10/12's own
  code comments as something for this phase to revisit. Moved the
  dashboard onto the httpOnly-cookie + CSRF double-submit flow the API
  always supported (`apps/web/src/lib/api.ts`, `login/page.tsx`,
  `dashboard/page.tsx`) — the JWT itself never touches page JavaScript
  now; only the non-httpOnly `csrf_token` cookie is read client-side,
  which is the whole point of the double-submit pattern. Verified with a
  real Playwright browser run: login → dashboard → a mutating action
  (Start) succeeds with the CSRF header attached → session survives a
  reload → Sign Out clears both cookies server-side → a direct nav to
  `/dashboard` after sign-out bounces back to `/login`.
- **No CORS allow-list in production**: `origin: false` in production
  silently allowed *no* cross-origin browser requests but gave no way to
  actually allow the real dashboard origin once deployed — the code
  comment said "Phase 14 wires a real allow-list." Added `CORS_ORIGIN`
  (comma-separated) to `config.ts`/`.env.example`; unset in production
  still means same-origin-only, not "allow everything."
- **No standard security headers**: added `@fastify/helmet` (defaults —
  `X-Content-Type-Options`, `X-Frame-Options`, HSTS, a `script-src 'self'`
  CSP, etc). Verified the headers actually appear on a real response and
  that they don't block legitimate cross-origin dashboard→API fetches
  (`Cross-Origin-Resource-Policy: same-origin` only restricts `no-cors`
  loads, not the `cors`-mode `fetch()` calls this app makes — confirmed
  in a real browser, not assumed).
- **Uncaught errors leaked internal detail**: Fastify's built-in default
  error handler forwards a thrown error's own `.message` into the JSON
  response for *any* status code, including 500s — a raw Postgres error
  or an internal bug would describe itself to the client. Added a global
  `setErrorHandler` (`server.ts`) that logs full detail server-side but
  returns a generic `"Internal server error"` for anything ≥500.
  Discovered along the way: several routes validate `:id`/query params
  with zod's `.parse()` (throws `ZodError`, uncaught) instead of
  `safeParse` — those are genuine 400s (bad client input), not 500s, so
  the handler special-cases `ZodError` into a proper 400 rather than
  papering over the bug with a generic message. Covered by a new test
  (malformed `:id` on `/api/positions/:id/close` now returns 400, not an
  unhandled exception).
- **Live execution trusted "this account key appeared in the
  transaction" instead of "this account key signed it"**: every Solana
  transaction and the public keys involved in it are public information
  — findable on any block explorer. `SolanaTransactionVerifier.verifySwap`
  matched `userPublicKey` against *any* account referenced by the
  transaction (a pool authority, another wallet's token account),
  not specifically a signer. Combined with nothing tying the claimed
  `userPublicKey` to the authenticated account, this meant an
  authenticated caller could name a stranger's real, unrelated,
  already-public swap and have it recorded as their own trade. Fixed
  two ways: (1) `verifySwap` now requires `signer: true` on the matched
  account (`onChain.ts`) — the claimed key must have actually
  authorized the transaction, not just appeared in it; (2)
  `/api/execution/quote` and `/api/execution/confirm` now check the
  claimed `userPublicKey` against wallets the authenticated account
  actually connected via `POST /api/wallet/connect` (`ownsConnectedWallet`
  in `execution.ts`), so the on-chain proof is tied back to *this*
  account specifically. Both covered by new tests — a non-signer account
  key is rejected (`onChain.test.ts`), and an unconnected public key is
  refused before any network call (`execution.integration.test.ts`,
  reachable with `ENABLE_LIVE_TRADING=true` and no live RPC, since the
  ownership check runs before the Jupiter/RPC calls).
- **Stale copy from before Phase 13 landed**: the dashboard's "Live Mode"
  button and the Telegram `/live` command both still said "not
  implemented yet, ships in Phase 13" — inaccurate once Phase 13 shipped
  as manual-only. Both now correctly describe the actual, permanent
  scope decision (autonomous LIVE is not offered; manual LIVE goes
  through the wallet-signed execution flow, not the bot's mode switch or
  Telegram).
- **No log redaction**: Fastify's default request/response log lines
  don't include headers or body already (confirmed by reading actual dev
  server output — just method/url/host/remoteAddress), so this wasn't an
  active leak, but added an explicit `redact` list for the
  Authorization/cookie/set-cookie headers anyway as defense-in-depth
  against a future direct log of a raw request/response object.

**Reviewed and found sound (no change needed):**

- **SQL injection**: every repository query uses parameterized queries
  (`$1`, `$2`, ...); grepped the whole `db/repositories/` tree for
  template-literal interpolation of a value into a query string —
  none found.
- **Route ownership scoping**: every authenticated route that touches a
  user-owned resource (positions, strategies, wallet, trades) scopes by
  `request.userId` from the verified JWT, never a client-supplied id, and
  update/delete paths explicitly re-check `resource.userId ===
  request.userId` before acting (returns 404, not 403, so existence isn't
  leaked either) — this was already the pattern going in; audited it
  route-by-route rather than assuming it held everywhere.
- **Telegram bot authorization**: every command is gated behind a
  chat-id check in middleware, before any command handler runs — the bot
  token alone (which could leak) isn't sufficient to control trading.
  Already built this way in Phase 11; re-verified here.
- **WebSocket broadcasts to every connected socket with no per-user
  filtering**: by design, not an oversight — this is a single-operator
  system (see `auth/bootstrap.ts`; the `users` table exists for
  multi-device login by the one operator, not multi-tenancy, and there's
  no signup route). Every authenticated socket belongs to the same
  person, potentially on multiple devices, so broadcasting portfolio/
  position/trade updates to all of them is correct. This would need
  revisiting before ever supporting more than one real operator account.
- **Password hashing**: bcrypt at 12 salt rounds — reasonable for this
  scale, no change made.
- **Private key handling**: grepped the whole codebase for
  `privateKey`/`secretKey`/`seedPhrase`/`mnemonic` — zero matches. The
  wallet integration is read-only-public-key plus browser-side signing
  (Phantom) by construction; there's nothing to leak because the server
  never receives it in the first place.

**Accepted, not fixed (with reasoning):**

- **`vitest@2.1.9`'s own dependency chain carries a critical advisory**
  (arbitrary file read via the Vitest UI server —
  [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)).
  This is a *dev-only* tool vulnerability, exploitable only when Vitest's
  `--ui` server is actively running; grepped every `package.json` script
  in the monorepo — `--ui` is never used. The fix is `vitest@5`, a major
  version bump across every workspace's test suite (231 tests); given the
  vulnerability requires a mode this project never enables, upgrading
  wasn't worth the regression risk it would introduce right before a
  security-focused phase. Worth revisiting on its own, deliberately, not
  as a drive-by version bump here.
- **Remaining production `npm audit` findings (22, down from 24)**: all
  come from `@solana/web3.js`'s own dependency chain (`jayson` →
  `stream-json`/`uuid`, both DoS-class, no fix published yet) or from
  `next`'s bundled `postcss` (fix requires `next@16`, a breaking Next.js
  major version). These are upstream issues in actively-maintained
  ecosystem packages this project depends on directly for core
  functionality (Solana RPC client, the web framework) — not something
  fixable by a local code change, and not worth a risky framework major
  bump as a side effect of a security-audit phase. Tracked here so
  they're not silently forgotten; re-run `npm audit --omit=dev`
  periodically and take the fix once one exists upstream.

**Verification**: full monorepo — 235 tests passing (up from 230 before
this phase), typecheck clean across all five workspaces, and the
cookie+CSRF dashboard migration verified end-to-end in a real Playwright
browser session (not just unit tests), the same standard every prior
frontend-touching phase in this project was held to.

## Development Order

- [x] Phase 1 — Project architecture
- [x] Phase 2 — Database
- [x] Phase 3 — Solana connection
- [x] Phase 4 — Real-time token scanner
- [x] Phase 5 — Scoring Engine
- [x] Phase 6 — Paper Trading
- [x] Phase 7 — Strategy Engine
- [x] Phase 8 — Risk Engine
- [x] Phase 9 — TP / SL / Trailing Stop
- [x] Phase 10 — Dashboard (reduced scope — see above)
- [x] Phase 11 — Telegram
- [x] Phase 12 — Wallet Adapter
- [x] Phase 13 — Live Execution Adapter (manual-only — see above)
- [x] Phase 14 — Security Audit (see above)
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

### Running the API + Dashboard together

```bash
# Terminal 1 — API (set ADMIN_EMAIL/ADMIN_PASSWORD in .env first to seed a login)
npm run dev --workspace apps/api        # http://localhost:4000

# Terminal 2 — Dashboard
NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev --workspace apps/web   # http://localhost:3000
```
Sign in at `/login` with the seeded `ADMIN_EMAIL`/`ADMIN_PASSWORD`. A brand
new account has no risk configuration yet — `PUT /api/risk-config` (no UI
for this yet, see the Dashboard scope note above) needs to be called at
least once before a manual buy will pass the Risk Engine.

## License

Personal-use project. Not audited. Trading is risky; live transactions can
result in loss of funds.
