import { describe, expect, it, vi } from 'vitest';
import { impliedPrice, JupiterSwapAdapter, WRAPPED_SOL_MINT, type FetchLike, type JupiterQuote } from '../src/execution/jupiterSwapAdapter.js';

const MINT = 'Mint1111111111111111111111111111111111111';

function fakeQuote(overrides: Partial<JupiterQuote> = {}): JupiterQuote {
  return {
    inputMint: WRAPPED_SOL_MINT,
    outputMint: MINT,
    inAmount: '100000000',
    outAmount: '5000000000',
    otherAmountThreshold: '4950000000',
    swapMode: 'ExactIn',
    slippageBps: 100,
    priceImpactPct: '0.5',
    routePlan: [],
    ...overrides,
  };
}

function fetchReturning(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

describe('JupiterSwapAdapter.getQuote', () => {
  it('builds the request with inputMint/outputMint/amount/slippageBps and parses the response', async () => {
    const fetchImpl = fetchReturning(fakeQuote());
    const adapter = new JupiterSwapAdapter('https://lite-api.jup.ag/swap/v1', fetchImpl);
    const quote = await adapter.getQuote({
      inputMint: WRAPPED_SOL_MINT,
      outputMint: MINT,
      amountBaseUnits: 100_000_000,
      slippageBps: 100,
    });
    expect(quote.outAmount).toBe('5000000000');
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain('inputMint=' + WRAPPED_SOL_MINT);
    expect(calledUrl).toContain('outputMint=' + MINT);
    expect(calledUrl).toContain('amount=100000000');
    expect(calledUrl).toContain('slippageBps=100');
  });

  it('throws on a non-OK response instead of silently returning empty data', async () => {
    const adapter = new JupiterSwapAdapter('https://lite-api.jup.ag/swap/v1', fetchReturning({}, false, 429));
    await expect(
      adapter.getQuote({ inputMint: WRAPPED_SOL_MINT, outputMint: MINT, amountBaseUnits: 1, slippageBps: 100 }),
    ).rejects.toThrow('HTTP 429');
  });
});

describe('JupiterSwapAdapter.buildSwapTransaction', () => {
  it('POSTs the quote + userPublicKey and returns the base64 transaction', async () => {
    const fetchImpl = fetchReturning({ swapTransaction: 'BASE64DATA==' });
    const adapter = new JupiterSwapAdapter('https://lite-api.jup.ag/swap/v1', fetchImpl);
    const tx = await adapter.buildSwapTransaction(fakeQuote(), 'UserPubkey111111111111111111111111111111');
    expect(tx).toBe('BASE64DATA==');
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body as string);
    expect(payload.userPublicKey).toBe('UserPubkey111111111111111111111111111111');
    expect(payload.quoteResponse.outAmount).toBe('5000000000');
  });

  it('throws on a non-OK response', async () => {
    const adapter = new JupiterSwapAdapter('https://lite-api.jup.ag/swap/v1', fetchReturning({}, false, 500));
    await expect(adapter.buildSwapTransaction(fakeQuote(), 'pk')).rejects.toThrow('HTTP 500');
  });
});

describe('impliedPrice', () => {
  it('is outAmount / inAmount in base-unit terms', () => {
    const quote = fakeQuote({ inAmount: '100', outAmount: '500' });
    expect(impliedPrice(quote)).toBe(5);
  });
});
