import type { Position, StrategyConfig, TokenScores, TokenSnapshot } from '@pump-scalper/shared';

export function baseSnapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    mint: 'Mint1111111111111111111111111111111111111',
    name: 'Doge Killer',
    symbol: 'DOGEK',
    creator: 'Creator111111111111111111111111111111111',
    ageSeconds: 120,
    priceSol: 0.00001,
    marketCapSol: 20,
    liquiditySol: 5,
    volumeSol5m: 3,
    buys5m: 15,
    sells5m: 5,
    uniqueBuyers5m: 12,
    uniqueSellers5m: 4,
    holders: 40,
    creatorHoldingPercent: 5,
    topHolderConcentrationPercent: 20,
    bondingCurveStatus: 'ACTIVE',
    graduationStatus: 'NOT_GRADUATED',
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function baseStrategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    userId: '11111111-1111-1111-1111-111111111111',
    name: 'Test Strategy',
    enabled: true,
    autonomous: false,
    tokenAgeSeconds: { min: 0, max: 600 },
    liquiditySol: { min: 2, max: null },
    volumeSolMin: 1,
    marketCapSol: { min: null, max: 200 },
    buySellRatioMin: 1.2,
    uniqueBuyersMin: 5,
    holderConcentrationPercentMax: 50,
    creatorHoldingPercentMax: 15,
    opportunityScoreMin: 85,
    riskScoreMax: 30,
    momentumScoreMin: 70,
    liquidityScoreMin: 60,
    buyPressureScoreMin: 65,
    scoreWeights: {
      momentumWeight: 1,
      liquidityWeight: 1,
      volumeWeight: 1,
      buyPressureWeight: 1,
      holderWeight: 1,
      creatorRiskWeight: 1,
    },
    positionSizeSol: 0.1,
    stopLossPercent: 15,
    stopLossMode: 'FIXED',
    takeProfitLevels: [{ triggerPercent: 10, sellPercent: 50 }],
    trailingStopPercent: 10,
    maxHoldingTimeSeconds: 600,
    maxPositions: 3,
    maxTradesPerDay: 20,
    maxDailyLossSol: 0.5,
    maxSlippageBps: 500,
    ...overrides,
  };
}

export function baseScores(overrides: Partial<TokenScores> = {}): TokenScores {
  return {
    mint: 'Mint1111111111111111111111111111111111111',
    opportunityScore: 90,
    riskScore: 20,
    momentumScore: 80,
    liquidityScore: 75,
    buyPressureScore: 70,
    holderScore: 60,
    creatorRiskScore: 10,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function basePosition(overrides: Partial<Position> = {}): Position {
  const entryPrice = 0.00001;
  return {
    id: '22222222-2222-2222-2222-222222222222',
    userId: '11111111-1111-1111-1111-111111111111',
    strategyId: null,
    mode: 'PAPER',
    status: 'OPEN',
    mint: 'Mint1111111111111111111111111111111111111',
    tokenName: 'Doge Killer',
    tokenSymbol: 'DOGEK',
    entryPrice,
    currentPrice: entryPrice,
    highestPrice: entryPrice,
    quantity: 1_000_000,
    originalQuantity: 1_000_000,
    entryValueSol: 0.1,
    currentValueSol: 0.1,
    unrealizedPnlSol: 0,
    unrealizedPnlPercent: 0,
    realizedPnlSol: 0,
    stopLossPercent: 15,
    stopLossPrice: entryPrice * 0.85,
    stopLossMode: 'FIXED',
    takeProfitLevels: [
      { triggerPercent: 10, sellPercent: 25, executed: false, executedAt: null },
      { triggerPercent: 20, sellPercent: 25, executed: false, executedAt: null },
      { triggerPercent: 35, sellPercent: 25, executed: false, executedAt: null },
    ],
    trailingStopPercent: 10,
    trailingStopPrice: null,
    entryOpportunityScore: 88,
    entryRiskScore: 20,
    entryTime: new Date().toISOString(),
    closedAt: null,
    holdingTimeSeconds: 0,
    ...overrides,
  };
}
