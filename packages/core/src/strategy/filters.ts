import type { StrategyConfig, TokenSnapshot } from '@pump-scalper/shared';

export interface FilterCheckResult {
  matches: boolean;
  failedFilters: string[];
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (value === null) return min === null && max === null; // unknown value only "passes" a filter that doesn't require it
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/**
 * The Strategy Builder's discovery filters (token age/liquidity/volume/
 * market cap/buy-sell ratio/unique buyers/holder concentration/creator
 * holding). This is a pure gate on the token's own data — it says nothing
 * about scores or risk; `evaluateSignal` (signal.ts) layers score
 * thresholds on top, and the Risk Engine (Phase 8) is the final gate
 * before any execution regardless of what this returns.
 */
export function matchesStrategyFilters(snapshot: TokenSnapshot, strategy: StrategyConfig): FilterCheckResult {
  const failedFilters: string[] = [];

  if (!inRange(snapshot.ageSeconds, strategy.tokenAgeSeconds.min, strategy.tokenAgeSeconds.max)) {
    failedFilters.push('tokenAgeSeconds');
  }
  if (!inRange(snapshot.liquiditySol, strategy.liquiditySol.min, strategy.liquiditySol.max)) {
    failedFilters.push('liquiditySol');
  }
  if (strategy.volumeSolMin !== null) {
    if (snapshot.volumeSol5m === null || snapshot.volumeSol5m < strategy.volumeSolMin) {
      failedFilters.push('volumeSolMin');
    }
  }
  if (!inRange(snapshot.marketCapSol, strategy.marketCapSol.min, strategy.marketCapSol.max)) {
    failedFilters.push('marketCapSol');
  }
  if (strategy.buySellRatioMin !== null) {
    const buys = snapshot.buys5m;
    const sells = snapshot.sells5m;
    const ratio = buys !== null && sells !== null && sells > 0 ? buys / sells : buys !== null && sells === 0 && buys > 0 ? Infinity : null;
    if (ratio === null || ratio < strategy.buySellRatioMin) {
      failedFilters.push('buySellRatioMin');
    }
  }
  if (strategy.uniqueBuyersMin !== null) {
    if (snapshot.uniqueBuyers5m === null || snapshot.uniqueBuyers5m < strategy.uniqueBuyersMin) {
      failedFilters.push('uniqueBuyersMin');
    }
  }
  if (strategy.holderConcentrationPercentMax !== null) {
    // Unknown concentration is NOT assumed safe when the strategy explicitly caps it.
    if (snapshot.topHolderConcentrationPercent === null || snapshot.topHolderConcentrationPercent > strategy.holderConcentrationPercentMax) {
      failedFilters.push('holderConcentrationPercentMax');
    }
  }
  if (strategy.creatorHoldingPercentMax !== null) {
    if (snapshot.creatorHoldingPercent === null || snapshot.creatorHoldingPercent > strategy.creatorHoldingPercentMax) {
      failedFilters.push('creatorHoldingPercentMax');
    }
  }

  return { matches: failedFilters.length === 0, failedFilters };
}
