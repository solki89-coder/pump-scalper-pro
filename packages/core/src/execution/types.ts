/**
 * The interface both the paper engine (this phase) and the live engine
 * (Phase 13, disabled unless ENABLE_LIVE_TRADING=true) implement. Every
 * trade — manual, strategy-triggered, or autonomous — goes through one of
 * these, never a bespoke path, so paper and live behave identically except
 * for whether a transaction actually leaves the machine.
 */
export interface BuyQuoteRequest {
  mint: string;
  sizeSol: number;
  currentPriceSol: number;
  liquiditySol: number;
  maxSlippageBps: number;
}

export interface SellQuoteRequest {
  mint: string;
  quantity: number;
  currentPriceSol: number;
  liquiditySol: number;
  maxSlippageBps: number;
}

export interface Quote {
  expectedPriceSol: number;
  expectedSlippageBps: number;
  estimatedFeesSol: number;
}

export interface ExecutionResult {
  fillPriceSol: number;
  quantity: number;
  sizeSol: number;
  feesSol: number;
  slippageBps: number;
  /** null in paper mode — no transaction is ever sent (spec requirement). */
  txSignature: string | null;
}

export interface ExecutionEngine {
  quoteBuy(req: BuyQuoteRequest): Promise<Quote>;
  quoteSell(req: SellQuoteRequest): Promise<Quote>;
  executeBuy(req: BuyQuoteRequest): Promise<ExecutionResult>;
  executeSell(req: SellQuoteRequest): Promise<ExecutionResult>;
  estimateFees(notionalSol: number): number;
  estimateSlippage(notionalSol: number, liquiditySol: number): number;
}

/** Thrown by a quote/execute call when the resulting slippage would exceed the caller's own maxSlippageBps. */
export class SlippageExceededError extends Error {
  constructor(
    public readonly expectedSlippageBps: number,
    public readonly maxSlippageBps: number,
  ) {
    super(`Expected slippage ${expectedSlippageBps}bps exceeds max allowed ${maxSlippageBps}bps`);
    this.name = 'SlippageExceededError';
  }
}
