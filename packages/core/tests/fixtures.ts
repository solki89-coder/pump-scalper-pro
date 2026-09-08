import type { TokenSnapshot } from '@pump-scalper/shared';

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
