import { describe, expect, it } from 'vitest';
import { matchesStrategyFilters } from '../../src/strategy/filters.js';
import { baseSnapshot, baseStrategy } from '../fixtures.js';

describe('matchesStrategyFilters', () => {
  it('matches a snapshot that satisfies every filter', () => {
    const result = matchesStrategyFilters(baseSnapshot(), baseStrategy());
    expect(result).toEqual({ matches: true, failedFilters: [] });
  });

  it('fails tokenAgeSeconds when the token is older than max', () => {
    const result = matchesStrategyFilters(baseSnapshot({ ageSeconds: 9999 }), baseStrategy());
    expect(result.matches).toBe(false);
    expect(result.failedFilters).toContain('tokenAgeSeconds');
  });

  it('fails liquiditySol when below the strategy minimum', () => {
    const result = matchesStrategyFilters(baseSnapshot({ liquiditySol: 0.5 }), baseStrategy());
    expect(result.failedFilters).toContain('liquiditySol');
  });

  it('fails volumeSolMin when volume data is missing, not just when it is low', () => {
    const result = matchesStrategyFilters(baseSnapshot({ volumeSol5m: null }), baseStrategy());
    expect(result.failedFilters).toContain('volumeSolMin');
  });

  it('computes buySellRatioMin from buys/sells and fails when the ratio is too low', () => {
    const result = matchesStrategyFilters(baseSnapshot({ buys5m: 1, sells5m: 10 }), baseStrategy());
    expect(result.failedFilters).toContain('buySellRatioMin');
  });

  it('treats all-buys-no-sells as satisfying any buySellRatioMin', () => {
    const result = matchesStrategyFilters(baseSnapshot({ buys5m: 10, sells5m: 0 }), baseStrategy());
    expect(result.failedFilters).not.toContain('buySellRatioMin');
  });

  it('treats unknown holder concentration as failing a strategy that caps it — never assumed safe', () => {
    const result = matchesStrategyFilters(baseSnapshot({ topHolderConcentrationPercent: null }), baseStrategy());
    expect(result.failedFilters).toContain('holderConcentrationPercentMax');
  });

  it('treats unknown creator holding as failing a strategy that caps it', () => {
    const result = matchesStrategyFilters(baseSnapshot({ creatorHoldingPercent: null }), baseStrategy());
    expect(result.failedFilters).toContain('creatorHoldingPercentMax');
  });

  it('ignores a filter entirely when the strategy leaves it unset (null)', () => {
    const strategy = baseStrategy({ holderConcentrationPercentMax: null, creatorHoldingPercentMax: null });
    const result = matchesStrategyFilters(baseSnapshot({ topHolderConcentrationPercent: null, creatorHoldingPercent: null }), strategy);
    expect(result.failedFilters).not.toContain('holderConcentrationPercentMax');
    expect(result.failedFilters).not.toContain('creatorHoldingPercentMax');
  });
});
