import type { MarketData, TokenCreationEvent } from '@pump-scalper/solana';
import type { TokenSnapshot } from '@pump-scalper/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  TokenScanner,
  type DiscoverySourcePort,
  type MarketDataPort,
  type TokenRepositoryPort,
} from '../src/scanner/tokenScanner.js';

function fakeRepo(): TokenRepositoryPort & { store: Map<string, TokenSnapshot> } {
  const store = new Map<string, TokenSnapshot>();
  return {
    store,
    async upsertToken(snapshot) {
      store.set(snapshot.mint, snapshot);
      return snapshot;
    },
    async getToken(mint) {
      return store.get(mint) ?? null;
    },
  };
}

function fakeDiscovery(): DiscoverySourcePort & { emitDiscovered: (e: TokenCreationEvent) => void; started: boolean } {
  let discoveredCb: ((e: TokenCreationEvent) => void) | null = null;
  return {
    started: false,
    on(event, cb) {
      if (event === 'discovered') discoveredCb = cb as never;
      return this;
    },
    start() {
      (this as { started: boolean }).started = true;
    },
    async stop() {
      (this as { started: boolean }).started = false;
    },
    emitDiscovered(e) {
      discoveredCb?.(e);
    },
  };
}

const EVENT: TokenCreationEvent = {
  signature: 'sig1',
  slot: 1,
  blockTime: Math.floor(Date.now() / 1000) - 10,
  mint: 'Mint1111111111111111111111111111111111111',
  creator: 'Creator111111111111111111111111111111111',
};

describe('TokenScanner', () => {
  it('persists a PENDING_METADATA placeholder the instant a token is discovered', async () => {
    const repo = fakeRepo();
    const market: MarketDataPort = { getMarketData: vi.fn().mockResolvedValue(null) };
    const scanner = new TokenScanner(fakeDiscovery(), market, repo);

    await scanner.handleDiscovered(EVENT);

    const stored = repo.store.get(EVENT.mint);
    expect(stored?.name).toBe('PENDING_METADATA');
    expect(stored?.symbol).toBe('PENDING_METADATA');
    expect(stored?.creator).toBe(EVENT.creator);
    expect(stored?.ageSeconds).toBeGreaterThanOrEqual(9);
    expect(stored?.bondingCurveStatus).toBe('ACTIVE');
  });

  it('replaces the placeholder with real DexScreener data once the pair is indexed', async () => {
    const repo = fakeRepo();
    const marketData: MarketData = {
      name: 'Doge Killer',
      symbol: 'DOGEK',
      priceSol: 0.00002,
      marketCapSol: 20,
      liquiditySol: 3,
      volumeSol5m: 1,
      buys5m: 10,
      sells5m: 2,
      bondingCurveStatus: 'ACTIVE',
      graduationStatus: 'NOT_GRADUATED',
      ageSecondsFromPair: 30,
    };
    const market: MarketDataPort = { getMarketData: vi.fn().mockResolvedValue(marketData) };
    const scanner = new TokenScanner(fakeDiscovery(), market, repo);

    await scanner.handleDiscovered(EVENT);
    await scanner.enrichPending();

    const stored = repo.store.get(EVENT.mint);
    expect(stored?.name).toBe('Doge Killer');
    expect(stored?.symbol).toBe('DOGEK');
    expect(stored?.liquiditySol).toBe(3);
    expect(stored?.creator).toBe(EVENT.creator); // preserved from the original discovery, not overwritten
  });

  it('leaves the placeholder untouched when DexScreener has not indexed the pair yet', async () => {
    const repo = fakeRepo();
    const market: MarketDataPort = { getMarketData: vi.fn().mockResolvedValue(null) };
    const scanner = new TokenScanner(fakeDiscovery(), market, repo);

    await scanner.handleDiscovered(EVENT);
    await scanner.enrichPending();

    expect(repo.store.get(EVENT.mint)?.name).toBe('PENDING_METADATA');
  });

  it('does not let one mint failing enrichment stop the others', async () => {
    const repo = fakeRepo();
    const marketData: MarketData = {
      name: 'OK Token',
      symbol: 'OK',
      priceSol: 1,
      marketCapSol: 1,
      liquiditySol: 1,
      volumeSol5m: 1,
      buys5m: 1,
      sells5m: 1,
      bondingCurveStatus: 'ACTIVE',
      graduationStatus: 'NOT_GRADUATED',
      ageSecondsFromPair: 1,
    };
    const getMarketData = vi.fn().mockImplementation((mint: string) => {
      if (mint === 'Bad') return Promise.reject(new Error('rate limited'));
      return Promise.resolve(marketData);
    });
    const errors: unknown[] = [];
    const scanner = new TokenScanner(fakeDiscovery(), { getMarketData }, repo, {
      info: () => {},
      error: (_, err) => errors.push(err),
    });

    await scanner.handleDiscovered({ ...EVENT, mint: 'Bad' });
    await scanner.handleDiscovered({ ...EVENT, mint: 'Good1111111111111111111111111111111111111' });
    await scanner.enrichPending();

    expect(errors).toHaveLength(1);
    expect(repo.store.get('Good1111111111111111111111111111111111111')?.name).toBe('OK Token');
  });

  it('start() wires discovery events and stop() tears down the enrichment timer', async () => {
    vi.useFakeTimers();
    const repo = fakeRepo();
    const market: MarketDataPort = { getMarketData: vi.fn().mockResolvedValue(null) };
    const discovery = fakeDiscovery();
    const scanner = new TokenScanner(discovery, market, repo, console, 1000);

    scanner.start();
    expect(discovery.started).toBe(true);

    discovery.emitDiscovered(EVENT);
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.store.has(EVENT.mint)).toBe(true);

    await scanner.stop();
    expect(discovery.started).toBe(false);
    vi.useRealTimers();
  });
});
