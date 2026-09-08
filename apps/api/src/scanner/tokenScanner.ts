import type { MarketData } from '@pump-scalper/solana';
import type { TokenCreationEvent } from '@pump-scalper/solana/server';
import type { TokenSnapshot } from '@pump-scalper/shared';
import { NoopTelegramAlerts, type TelegramAlertsPort } from '../telegram/alerts.js';

export interface TokenRepositoryPort {
  upsertToken(snapshot: TokenSnapshot): Promise<TokenSnapshot>;
  getToken(mint: string): Promise<TokenSnapshot | null>;
}

export interface MarketDataPort {
  getMarketData(mint: string): Promise<MarketData | null>;
}

export interface DiscoverySourcePort {
  on(event: 'discovered', cb: (e: TokenCreationEvent) => void): unknown;
  on(event: 'error', cb: (e: Error) => void): unknown;
  start(): void;
  stop(): Promise<void>;
}

export interface ScannerLogger {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/** How long a mint without a fully-indexed DexScreener pair keeps getting polled before we give up. */
const ENRICHMENT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Orchestrates discovery (Phase 3/4's PumpFunTokenDiscovery) + market-data
 * enrichment (DexScreenerAdapter) into persisted TokenSnapshot rows.
 *
 * New tokens are persisted the instant they're seen on-chain, with
 * name/symbol set to the explicit 'PENDING_METADATA' sentinel (never a
 * guess) — see pumpfunEventDecoder.ts for why name/symbol aren't decoded
 * on-chain. A periodic sweep then asks DexScreener for market data for
 * every mint still pending enrichment or open as a position; once
 * DexScreener has indexed the pair, name/symbol/price/liquidity/volume all
 * update to real values in one upsert.
 */
export class TokenScanner {
  private readonly pending = new Map<string, { discoveredAt: number }>();
  private enrichTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly discovery: DiscoverySourcePort,
    private readonly market: MarketDataPort,
    private readonly repo: TokenRepositoryPort,
    private readonly logger: ScannerLogger = console,
    private readonly enrichIntervalMs = 15_000,
    private readonly alerts: TelegramAlertsPort = new NoopTelegramAlerts(),
  ) {}

  start(): void {
    this.discovery.on('discovered', (event) => void this.handleDiscovered(event));
    this.discovery.on('error', (err) => this.logger.error('token discovery error', err));
    this.discovery.start();
    this.enrichTimer = setInterval(() => void this.enrichPending(), this.enrichIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.enrichTimer) {
      clearInterval(this.enrichTimer);
      this.enrichTimer = null;
    }
    await this.discovery.stop();
  }

  /** Exposed for tests and for wiring an already-open position's mint back into the enrichment set. */
  watch(mint: string): void {
    if (!this.pending.has(mint)) this.pending.set(mint, { discoveredAt: Date.now() });
  }

  async handleDiscovered(event: TokenCreationEvent): Promise<void> {
    const ageSeconds = event.blockTime ? Math.max(0, Date.now() / 1000 - event.blockTime) : 0;
    const snapshot: TokenSnapshot = {
      mint: event.mint,
      name: 'PENDING_METADATA',
      symbol: 'PENDING_METADATA',
      creator: event.creator,
      ageSeconds,
      priceSol: 0,
      marketCapSol: null,
      liquiditySol: null,
      volumeSol5m: null,
      buys5m: null,
      sells5m: null,
      uniqueBuyers5m: null,
      uniqueSellers5m: null,
      holders: null,
      creatorHoldingPercent: null,
      topHolderConcentrationPercent: null,
      bondingCurveStatus: 'ACTIVE',
      graduationStatus: 'NOT_GRADUATED',
      observedAt: new Date().toISOString(),
    };
    await this.repo.upsertToken(snapshot);
    this.watch(event.mint);
    void this.alerts.newToken(snapshot);
  }

  async enrichPending(): Promise<void> {
    const now = Date.now();
    for (const [mint, { discoveredAt }] of this.pending) {
      if (now - discoveredAt > ENRICHMENT_TTL_MS) {
        this.pending.delete(mint);
        continue;
      }
      try {
        await this.enrichOne(mint);
      } catch (err) {
        this.logger.error(`enrichment failed for ${mint}`, err);
      }
    }
  }

  private async enrichOne(mint: string): Promise<void> {
    const data = await this.market.getMarketData(mint);
    if (!data) return; // not indexed by DexScreener yet — try again next sweep

    const existing = await this.repo.getToken(mint);
    if (!existing) return; // discovered by a different scanner instance / not ours to enrich

    const merged: TokenSnapshot = {
      ...existing,
      name: data.name || existing.name,
      symbol: data.symbol || existing.symbol,
      priceSol: data.priceSol ?? existing.priceSol,
      marketCapSol: data.marketCapSol,
      liquiditySol: data.liquiditySol,
      volumeSol5m: data.volumeSol5m,
      buys5m: data.buys5m,
      sells5m: data.sells5m,
      bondingCurveStatus: data.bondingCurveStatus,
      graduationStatus: data.graduationStatus,
      observedAt: new Date().toISOString(),
    };
    await this.repo.upsertToken(merged);

    // Once graduated off the bonding curve, DexScreener's own volume/buys/sells stay meaningful — keep polling.
    // Metadata resolved and no longer "pending" doesn't mean stop; scoring (Phase 5) needs live liquidity/volume
    // for as long as a position might be open, which the caller manages by removing mints via unwatch().
  }

  unwatch(mint: string): void {
    this.pending.delete(mint);
  }
}
