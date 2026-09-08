import {
  SlippageExceededError,
  type BuyQuoteRequest,
  type ExecutionEngine,
  type ExecutionResult,
  type Quote,
  type SellQuoteRequest,
} from './types.js';

export interface PaperExecutionConfig {
  /** Pump.fun's own documented platform fee — 1% (100 bps) on trade notional. */
  platformFeeBps: number;
  /** Flat estimate for Solana network/priority fees. Real cost varies with priority-fee market conditions. */
  networkFeeSol: number;
  /**
   * Linear price-impact approximation: slippageBps ≈ (size / liquidity) * impactFactorBps.
   * A real bonding curve's price impact is convex, not linear — this is a deliberately
   * simple, documented heuristic for paper simulation, not a claim of bonding-curve-exact pricing.
   */
  impactFactorBps: number;
  /** Injectable for deterministic tests; defaults to Math.random for realistic jitter. */
  randomFn: () => number;
}

export const DEFAULT_PAPER_EXECUTION_CONFIG: PaperExecutionConfig = {
  platformFeeBps: 100,
  networkFeeSol: 0.00001,
  impactFactorBps: 10_000,
  randomFn: Math.random,
};

/**
 * Simulates fills end to end (entry price, slippage, fees) without ever
 * sending a transaction — per spec, PAPER MODE must never touch the chain.
 * Every simulated trade is meant to be persisted exactly like a real one
 * (PaperTradingService, apps/api/src/trading).
 */
export class PaperExecutionEngine implements ExecutionEngine {
  constructor(private readonly config: PaperExecutionConfig = DEFAULT_PAPER_EXECUTION_CONFIG) {}

  estimateFees(notionalSol: number): number {
    return notionalSol * (this.config.platformFeeBps / 10_000) + this.config.networkFeeSol;
  }

  estimateSlippage(notionalSol: number, liquiditySol: number): number {
    if (liquiditySol <= 0) return 10_000; // no liquidity data/none available ⇒ treat as maximal, not zero, slippage
    const impact = (notionalSol / liquiditySol) * this.config.impactFactorBps;
    return Math.max(0, Math.round(impact));
  }

  async quoteBuy(req: BuyQuoteRequest): Promise<Quote> {
    const slippageBps = this.estimateSlippage(req.sizeSol, req.liquiditySol);
    return {
      expectedPriceSol: req.currentPriceSol * (1 + slippageBps / 10_000),
      expectedSlippageBps: slippageBps,
      estimatedFeesSol: this.estimateFees(req.sizeSol),
    };
  }

  async quoteSell(req: SellQuoteRequest): Promise<Quote> {
    const notional = req.quantity * req.currentPriceSol;
    const slippageBps = this.estimateSlippage(notional, req.liquiditySol);
    return {
      expectedPriceSol: req.currentPriceSol * (1 - slippageBps / 10_000),
      expectedSlippageBps: slippageBps,
      estimatedFeesSol: this.estimateFees(notional),
    };
  }

  async executeBuy(req: BuyQuoteRequest): Promise<ExecutionResult> {
    const quote = await this.quoteBuy(req);
    if (quote.expectedSlippageBps > req.maxSlippageBps) {
      throw new SlippageExceededError(quote.expectedSlippageBps, req.maxSlippageBps);
    }
    // Jitter within [0, expected] so paper fills aren't suspiciously exact — bounded, never worse than the quote.
    const jitteredSlippageBps = Math.round(quote.expectedSlippageBps * this.config.randomFn());
    const fillPriceSol = req.currentPriceSol * (1 + jitteredSlippageBps / 10_000);
    const feesSol = this.estimateFees(req.sizeSol);
    const quantity = Math.max(0, (req.sizeSol - feesSol) / fillPriceSol);
    return { fillPriceSol, quantity, sizeSol: req.sizeSol, feesSol, slippageBps: jitteredSlippageBps, txSignature: null };
  }

  async executeSell(req: SellQuoteRequest): Promise<ExecutionResult> {
    const quote = await this.quoteSell(req);
    if (quote.expectedSlippageBps > req.maxSlippageBps) {
      throw new SlippageExceededError(quote.expectedSlippageBps, req.maxSlippageBps);
    }
    const jitteredSlippageBps = Math.round(quote.expectedSlippageBps * this.config.randomFn());
    const fillPriceSol = req.currentPriceSol * (1 - jitteredSlippageBps / 10_000);
    const grossSol = req.quantity * fillPriceSol;
    const feesSol = this.estimateFees(grossSol);
    const sizeSol = Math.max(0, grossSol - feesSol);
    return { fillPriceSol, quantity: req.quantity, sizeSol, feesSol, slippageBps: jitteredSlippageBps, txSignature: null };
  }
}
