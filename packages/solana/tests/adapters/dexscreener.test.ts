import { describe, expect, it, vi } from 'vitest';
import { DexScreenerAdapter, mapPairToMarketData, type DexPair, type FetchLike } from '../../src/adapters/dexscreener.js';

const MINT = 'Mint1111111111111111111111111111111111111';

function fakePair(overrides: Partial<DexPair> = {}): DexPair {
  return {
    chainId: 'solana',
    dexId: 'pumpfun',
    pairAddress: 'Pair111',
    baseToken: { address: MINT, name: 'Doge Killer', symbol: 'DOGEK' },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: '0.00001',
    priceUsd: '0.0023',
    liquidity: { usd: 9200, base: 400_000_000, quote: 4 },
    marketCap: 23000,
    volume: { m5: 460, h1: 5200 },
    txns: { m5: { buys: 12, sells: 4 } },
    pairCreatedAt: Date.now() - 60_000,
    ...overrides,
  };
}

describe('mapPairToMarketData', () => {
  it('converts USD-denominated fields to SOL using priceNative/priceUsd as the rate', () => {
    const data = mapPairToMarketData(fakePair());
    // usdToSol = 0.00001 / 0.0023
    const usdToSol = 0.00001 / 0.0023;
    expect(data.priceSol).toBeCloseTo(0.00001, 12);
    expect(data.marketCapSol).toBeCloseTo(23000 * usdToSol, 6);
    expect(data.volumeSol5m).toBeCloseTo(460 * usdToSol, 6);
    expect(data.liquiditySol).toBe(4); // taken directly from liquidity.quote, no conversion needed
    expect(data.buys5m).toBe(12);
    expect(data.sells5m).toBe(4);
  });

  it('marks pumpfun-dexId pairs as an active, non-graduated bonding curve', () => {
    const data = mapPairToMarketData(fakePair({ dexId: 'pumpfun' }));
    expect(data.bondingCurveStatus).toBe('ACTIVE');
    expect(data.graduationStatus).toBe('NOT_GRADUATED');
  });

  it('marks a migrated pair (e.g. raydium/pumpswap) as graduated', () => {
    const data = mapPairToMarketData(fakePair({ dexId: 'raydium' }));
    expect(data.bondingCurveStatus).toBe('GRADUATED');
    expect(data.graduationStatus).toBe('GRADUATED');
  });

  it('returns null for USD-derived fields when priceUsd is missing (no conversion rate available)', () => {
    const data = mapPairToMarketData(fakePair({ priceUsd: undefined }));
    expect(data.marketCapSol).toBeNull();
    expect(data.volumeSol5m).toBeNull();
    expect(data.priceSol).toBeCloseTo(0.00001, 12); // priceNative itself needs no conversion
  });
});

describe('DexScreenerAdapter', () => {
  function fetchReturning(body: unknown, ok = true, status = 200): FetchLike {
    return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
  }

  it('filters returned pairs to this chain and mint, and picks the deepest-liquidity SOL pair', async () => {
    const shallow = fakePair({ pairAddress: 'shallow', liquidity: { usd: 100, base: 1, quote: 0.5 } });
    const deep = fakePair({ pairAddress: 'deep', liquidity: { usd: 50_000, base: 1, quote: 20 } });
    const wrongChain = fakePair({ chainId: 'ethereum', pairAddress: 'eth' });
    const fetchImpl = fetchReturning({ pairs: [shallow, wrongChain, deep] });

    const adapter = new DexScreenerAdapter('https://api.dexscreener.com', fetchImpl);
    const data = await adapter.getMarketData(MINT);

    expect(fetchImpl).toHaveBeenCalledWith(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`);
    expect(data?.liquiditySol).toBe(20);
  });

  it('returns null when no pairs are indexed yet (brand-new token)', async () => {
    const adapter = new DexScreenerAdapter('https://api.dexscreener.com', fetchReturning({ pairs: [] }));
    expect(await adapter.getMarketData(MINT)).toBeNull();
  });

  it('returns null when pairs exist but none are SOL-quoted', async () => {
    const usdcPair = fakePair({ quoteToken: { address: 'USDC', name: 'USD Coin', symbol: 'USDC' } });
    const adapter = new DexScreenerAdapter('https://api.dexscreener.com', fetchReturning({ pairs: [usdcPair] }));
    expect(await adapter.getMarketData(MINT)).toBeNull();
  });

  it('throws on a non-OK HTTP response instead of silently returning empty data', async () => {
    const adapter = new DexScreenerAdapter('https://api.dexscreener.com', fetchReturning({}, false, 429));
    await expect(adapter.getPairsForMint(MINT)).rejects.toThrow('HTTP 429');
  });
});
