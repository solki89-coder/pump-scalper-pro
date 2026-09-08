import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAPER_EXECUTION_CONFIG,
  PaperExecutionEngine,
  type PaperExecutionConfig,
} from '../../src/execution/paperExecutionEngine.js';
import { SlippageExceededError } from '../../src/execution/types.js';

const deterministicConfig: PaperExecutionConfig = { ...DEFAULT_PAPER_EXECUTION_CONFIG, randomFn: () => 1 };

describe('PaperExecutionEngine.estimateFees', () => {
  it('charges the platform fee (1% default) plus a flat network fee', () => {
    const engine = new PaperExecutionEngine();
    expect(engine.estimateFees(1)).toBeCloseTo(0.01 + 0.00001, 8);
  });
});

describe('PaperExecutionEngine.estimateSlippage', () => {
  it('scales linearly with size relative to liquidity', () => {
    const engine = new PaperExecutionEngine();
    expect(engine.estimateSlippage(1, 10)).toBe(1000); // 10% of liquidity -> 1000bps at impactFactorBps=10000
    expect(engine.estimateSlippage(0.1, 10)).toBe(100);
  });

  it('treats zero/unknown liquidity as maximal slippage, never zero', () => {
    const engine = new PaperExecutionEngine();
    expect(engine.estimateSlippage(1, 0)).toBe(10_000);
  });
});

describe('PaperExecutionEngine.executeBuy', () => {
  it('never returns a transaction signature', async () => {
    const engine = new PaperExecutionEngine(deterministicConfig);
    const result = await engine.executeBuy({ mint: 'M', sizeSol: 0.1, currentPriceSol: 0.00001, liquiditySol: 10, maxSlippageBps: 5000 });
    expect(result.txSignature).toBeNull();
  });

  it('fills at a worse (higher) price than spot, reflecting slippage', async () => {
    const engine = new PaperExecutionEngine(deterministicConfig);
    const result = await engine.executeBuy({ mint: 'M', sizeSol: 0.1, currentPriceSol: 0.00001, liquiditySol: 10, maxSlippageBps: 5000 });
    expect(result.fillPriceSol).toBeGreaterThan(0.00001);
  });

  it('deducts fees before converting size to quantity', async () => {
    const engine = new PaperExecutionEngine({ ...deterministicConfig, impactFactorBps: 0 }); // isolate fees, no slippage
    const result = await engine.executeBuy({ mint: 'M', sizeSol: 1, currentPriceSol: 1, liquiditySol: 1000, maxSlippageBps: 5000 });
    const expectedFees = 1 * 0.01 + 0.00001;
    expect(result.feesSol).toBeCloseTo(expectedFees, 8);
    expect(result.quantity).toBeCloseTo(1 - expectedFees, 8); // price is 1, no slippage
  });

  it('rejects a buy whose expected slippage exceeds maxSlippageBps', async () => {
    const engine = new PaperExecutionEngine(deterministicConfig);
    await expect(
      engine.executeBuy({ mint: 'M', sizeSol: 5, currentPriceSol: 0.00001, liquiditySol: 1, maxSlippageBps: 100 }),
    ).rejects.toThrow(SlippageExceededError);
  });

  it('jitters slippage between 0 and the quoted expected value', async () => {
    const zeroJitter = new PaperExecutionEngine({ ...DEFAULT_PAPER_EXECUTION_CONFIG, randomFn: () => 0 });
    const result = await zeroJitter.executeBuy({ mint: 'M', sizeSol: 0.1, currentPriceSol: 0.00001, liquiditySol: 10, maxSlippageBps: 5000 });
    expect(result.slippageBps).toBe(0);
    expect(result.fillPriceSol).toBeCloseTo(0.00001, 12);
  });
});

describe('PaperExecutionEngine.executeSell', () => {
  it('fills at a worse (lower) price than spot, reflecting slippage', async () => {
    const engine = new PaperExecutionEngine(deterministicConfig);
    const result = await engine.executeSell({ mint: 'M', quantity: 100_000, currentPriceSol: 0.00001, liquiditySol: 5, maxSlippageBps: 5000 });
    expect(result.fillPriceSol).toBeLessThan(0.00001);
  });

  it('deducts fees from gross proceeds', async () => {
    const engine = new PaperExecutionEngine({ ...deterministicConfig, impactFactorBps: 0 });
    const result = await engine.executeSell({ mint: 'M', quantity: 100, currentPriceSol: 1, liquiditySol: 1000, maxSlippageBps: 5000 });
    const gross = 100;
    const expectedFees = gross * 0.01 + 0.00001;
    expect(result.sizeSol).toBeCloseTo(gross - expectedFees, 6);
  });

  it('rejects a sell whose expected slippage exceeds maxSlippageBps', async () => {
    const engine = new PaperExecutionEngine(deterministicConfig);
    await expect(
      engine.executeSell({ mint: 'M', quantity: 5_000_000, currentPriceSol: 0.00001, liquiditySol: 1, maxSlippageBps: 100 }),
    ).rejects.toThrow(SlippageExceededError);
  });
});
