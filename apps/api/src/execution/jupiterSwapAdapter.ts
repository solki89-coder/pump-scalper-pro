import { z } from 'zod';

/**
 * Jupiter's public swap aggregator API — confirmed (via their own
 * integration announcements) to route both pump.fun bonding-curve trades
 * and post-graduation PumpSwap/Raydium pools, so this is used instead of
 * hand-rolling pump.fun's own (unverified) instruction format — see
 * packages/solana/src/adapters/pumpfunEventDecoder.ts for why that gap was
 * deliberately left unfilled. Base URL is configurable
 * (JUPITER_API_BASE) because Jupiter has changed their public endpoint
 * before (quote-api.jup.ag → lite-api.jup.ag); verify against
 * https://dev.jup.ag before relying on this for real trades.
 */
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

const QuoteResponseSchema = z
  .object({
    inputMint: z.string(),
    outputMint: z.string(),
    inAmount: z.string(),
    outAmount: z.string(),
    otherAmountThreshold: z.string(),
    swapMode: z.string(),
    slippageBps: z.number(),
    priceImpactPct: z.string(),
    routePlan: z.array(z.unknown()),
  })
  .passthrough();
export type JupiterQuote = z.infer<typeof QuoteResponseSchema>;

const SwapResponseSchema = z.object({ swapTransaction: z.string() }).passthrough();

export type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amountBaseUnits: number;
  slippageBps: number;
}

export class JupiterSwapAdapter {
  constructor(
    private readonly apiBase: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async getQuote(params: QuoteParams): Promise<JupiterQuote> {
    const url = new URL(`${this.apiBase}/quote`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', String(Math.round(params.amountBaseUnits)));
    url.searchParams.set('slippageBps', String(params.slippageBps));
    const res = await this.fetchImpl(url.toString());
    if (!res.ok) throw new Error(`Jupiter quote failed: HTTP ${res.status}`);
    return QuoteResponseSchema.parse(await res.json());
  }

  /** Returns the base64-encoded, UNSIGNED transaction — the caller's wallet (Phantom) signs it, this code never does. */
  async buildSwapTransaction(quote: JupiterQuote, userPublicKey: string): Promise<string> {
    const res = await this.fetchImpl(`${this.apiBase}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true }),
    });
    if (!res.ok) throw new Error(`Jupiter swap build failed: HTTP ${res.status}`);
    const body = SwapResponseSchema.parse(await res.json());
    return body.swapTransaction;
  }
}

/** Implied execution price from a quote's in/out amounts, in output-per-input base-unit terms — the caller converts using each mint's decimals. */
export function impliedPrice(quote: JupiterQuote): number {
  return Number(quote.outAmount) / Number(quote.inAmount);
}
