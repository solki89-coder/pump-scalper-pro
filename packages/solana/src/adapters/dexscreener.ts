import { z } from 'zod';

/**
 * DexScreener public REST API — no key required. Confirmed against
 * docs.dexscreener.com/api/reference (Sept 2026): `GET /latest/dex/tokens/{tokenAddresses}`,
 * rate limit 300 req/min for DEX/Pairs endpoints. This adapter polls it —
 * it does not attempt to exceed the documented rate limit, and does not
 * attempt any workaround if DexScreener itself throttles or blocks a
 * request (per project rule: never bypass rate limits or security
 * mechanisms).
 */
const DEFAULT_API_BASE = 'https://api.dexscreener.com';

const DexPairSchema = z.object({
  chainId: z.string(),
  dexId: z.string(),
  pairAddress: z.string(),
  baseToken: z.object({ address: z.string(), name: z.string(), symbol: z.string() }),
  quoteToken: z.object({ address: z.string(), name: z.string(), symbol: z.string() }),
  priceNative: z.string().optional(),
  priceUsd: z.string().optional(),
  liquidity: z.object({ usd: z.number().optional(), base: z.number().optional(), quote: z.number().optional() }).optional(),
  fdv: z.number().optional(),
  marketCap: z.number().optional(),
  volume: z.object({ m5: z.number().optional(), h1: z.number().optional() }).optional(),
  txns: z
    .object({
      m5: z.object({ buys: z.number().optional(), sells: z.number().optional() }).optional(),
    })
    .optional(),
  pairCreatedAt: z.number().optional(),
});
export type DexPair = z.infer<typeof DexPairSchema>;

const DexTokensResponseSchema = z.object({
  schemaVersion: z.string().optional(),
  pairs: z.array(DexPairSchema).nullable(),
});

export interface MarketData {
  name: string;
  symbol: string;
  priceSol: number | null;
  marketCapSol: number | null;
  liquiditySol: number | null;
  volumeSol5m: number | null;
  buys5m: number | null;
  sells5m: number | null;
  bondingCurveStatus: 'ACTIVE' | 'GRADUATING' | 'GRADUATED' | 'UNKNOWN';
  graduationStatus: 'NOT_GRADUATED' | 'GRADUATED' | 'UNKNOWN';
  ageSecondsFromPair: number | null;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class DexScreenerAdapter {
  constructor(
    private readonly apiBase: string = DEFAULT_API_BASE,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  /** Raw pairs for a token mint (Solana chainId is `solana`). Empty array if the pair isn't indexed yet. */
  async getPairsForMint(mint: string): Promise<DexPair[]> {
    const res = await this.fetchImpl(`${this.apiBase}/latest/dex/tokens/${mint}`);
    if (!res.ok) {
      throw new Error(`DexScreener request failed: HTTP ${res.status}`);
    }
    const body = DexTokensResponseSchema.parse(await res.json());
    return (body.pairs ?? []).filter((p) => p.chainId === 'solana' && p.baseToken.address === mint);
  }

  /**
   * Picks the pair with the most liquidity (most representative price) and
   * maps it to SOL-denominated market data. Every USD figure DexScreener
   * returns is converted to SOL using priceNative/priceUsd as the implied
   * SOL-per-USD rate at that instant — no separate price feed dependency.
   * Returns null if no SOL-quoted pair is indexed for this mint yet.
   */
  async getMarketData(mint: string): Promise<MarketData | null> {
    const pairs = await this.getPairsForMint(mint);
    const solPairs = pairs.filter((p) => p.quoteToken.symbol.toUpperCase() === 'SOL');
    if (solPairs.length === 0) return null;

    const best = solPairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    return mapPairToMarketData(best);
  }
}

export function mapPairToMarketData(pair: DexPair): MarketData {
  const priceNative = pair.priceNative ? Number(pair.priceNative) : null;
  const priceUsd = pair.priceUsd ? Number(pair.priceUsd) : null;
  const usdToSol = priceUsd && priceUsd > 0 && priceNative !== null ? priceNative / priceUsd : null;

  const marketCapSol = usdToSol !== null && pair.marketCap !== undefined ? pair.marketCap * usdToSol : null;
  const volumeSol5m = usdToSol !== null && pair.volume?.m5 !== undefined ? pair.volume.m5 * usdToSol : null;

  const bondingCurveStatus = pair.dexId === 'pumpfun' ? 'ACTIVE' : pair.dexId ? 'GRADUATED' : 'UNKNOWN';
  const graduationStatus = pair.dexId === 'pumpfun' ? 'NOT_GRADUATED' : pair.dexId ? 'GRADUATED' : 'UNKNOWN';

  return {
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    priceSol: priceNative,
    marketCapSol,
    liquiditySol: pair.liquidity?.quote ?? null,
    volumeSol5m,
    buys5m: pair.txns?.m5?.buys ?? null,
    sells5m: pair.txns?.m5?.sells ?? null,
    bondingCurveStatus,
    graduationStatus,
    ageSecondsFromPair: pair.pairCreatedAt ? Math.max(0, (Date.now() - pair.pairCreatedAt) / 1000) : null,
  };
}
