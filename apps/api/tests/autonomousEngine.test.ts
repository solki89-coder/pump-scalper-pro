import type { Position, RiskCheckResult, RiskConfig, StrategyConfig, TokenSnapshot, Trade } from '@pump-scalper/shared';
import { describe, expect, it, vi } from 'vitest';
import { runAutonomousCycle, type AutonomousCyclePorts } from '../src/autonomous/autonomousEngine.js';

const riskConfig: RiskConfig = {
  userId: 'user1',
  maxPositionSizeSol: 0.5,
  maxDailyLossSol: 1,
  maxTotalExposureSol: 2,
  maxOpenPositions: 3,
  maxTradesPerDay: 20,
  maxSlippageBps: 500,
  minSolBalance: 0.1,
  autonomousEnabled: true,
  autonomousMaxPositionSol: 0.5,
  autonomousMaxDailyLossSol: 1,
  autonomousMaxTrades: 20,
  tradingAllocationSol: 2,
};

function strategy(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    id: 'strat1',
    userId: 'user1',
    name: 'Autonomous Sniper',
    enabled: true,
    autonomous: true,
    tokenAgeSeconds: { min: 0, max: 600 },
    liquiditySol: { min: 1, max: null },
    volumeSolMin: null,
    marketCapSol: { min: null, max: null },
    buySellRatioMin: null,
    uniqueBuyersMin: null,
    holderConcentrationPercentMax: null,
    creatorHoldingPercentMax: null,
    opportunityScoreMin: 60,
    riskScoreMax: 60,
    momentumScoreMin: 0,
    liquidityScoreMin: 0,
    buyPressureScoreMin: 0,
    scoreWeights: { momentumWeight: 1, liquidityWeight: 1, volumeWeight: 1, buyPressureWeight: 1, holderWeight: 1, creatorRiskWeight: 1 },
    positionSizeSol: 0.1,
    stopLossPercent: 15,
    stopLossMode: 'FIXED',
    takeProfitLevels: [],
    trailingStopPercent: null,
    maxHoldingTimeSeconds: null,
    maxPositions: 3,
    maxTradesPerDay: 20,
    maxDailyLossSol: 1,
    maxSlippageBps: 2000,
    ...overrides,
  };
}

function token(mint: string, overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    mint,
    name: 'Doge Killer',
    symbol: 'DOGEK',
    creator: 'Creator1',
    ageSeconds: 60,
    priceSol: 0.00001,
    marketCapSol: 20,
    liquiditySol: 5,
    volumeSol5m: 3,
    buys5m: 15,
    sells5m: 3,
    uniqueBuyers5m: 10,
    uniqueSellers5m: 3,
    holders: 50,
    creatorHoldingPercent: 3,
    topHolderConcentrationPercent: 15,
    bondingCurveStatus: 'ACTIVE',
    graduationStatus: 'NOT_GRADUATED',
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakePorts(overrides: Partial<AutonomousCyclePorts> = {}): AutonomousCyclePorts & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    getRiskConfig: vi.fn().mockResolvedValue(riskConfig),
    getSolBalance: vi.fn().mockResolvedValue(5),
    evaluateTrade: vi.fn().mockResolvedValue({ approved: true, reasons: [], checkedAt: new Date().toISOString() } satisfies RiskCheckResult),
    estimateSlippageBps: vi.fn().mockReturnValue(100),
    openPaperPosition: vi.fn().mockImplementation(async (_strategy, snapshot: TokenSnapshot) => {
      opened.push(snapshot.mint);
      return { position: {} as Position, trade: {} as Trade };
    }),
    ...overrides,
  };
}

describe('runAutonomousCycle', () => {
  it('does nothing at all when the kill switch is active', async () => {
    const ports = fakePorts();
    const result = await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy()], candidateTokens: [token('M1')], killSwitchActive: true, botMode: 'PAPER' },
      ports,
    );
    expect(result.opened).toEqual([]);
    expect(ports.evaluateTrade).not.toHaveBeenCalled();
  });

  it('refuses to run in LIVE mode — autonomous live trading does not exist until Phase 13', async () => {
    const ports = fakePorts();
    const result = await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy()], candidateTokens: [token('M1')], killSwitchActive: false, botMode: 'LIVE' },
      ports,
    );
    expect(result.opened).toEqual([]);
    expect(ports.openPaperPosition).not.toHaveBeenCalled();
  });

  it('opens a position for a qualifying candidate that clears the risk gate', async () => {
    const ports = fakePorts();
    const result = await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy()], candidateTokens: [token('M1')], killSwitchActive: false, botMode: 'PAPER' },
      ports,
    );
    expect(result.opened).toEqual([{ mint: 'M1', strategyId: 'strat1' }]);
    expect(ports.evaluateTrade).toHaveBeenCalledTimes(1);
    expect(ports.evaluateTrade).toHaveBeenCalledWith(
      expect.objectContaining({ isAutonomous: true, mode: 'PAPER', mint: 'M1' }),
      riskConfig,
    );
  });

  it('never calls openPaperPosition when the risk gate rejects the trade', async () => {
    const ports = fakePorts({
      evaluateTrade: vi.fn().mockResolvedValue({ approved: false, reasons: ['MAX_OPEN_POSITIONS'], checkedAt: new Date().toISOString() }),
    });
    const result = await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy()], candidateTokens: [token('M1')], killSwitchActive: false, botMode: 'PAPER' },
      ports,
    );
    expect(ports.openPaperPosition).not.toHaveBeenCalled();
    expect(result.rejectedByRisk).toEqual([{ mint: 'M1', reasons: ['MAX_OPEN_POSITIONS'] }]);
  });

  it('filters out tokens that do not meet the strategy thresholds before ranking', async () => {
    const ports = fakePorts();
    const weak = token('Weak', { buys5m: 1, sells5m: 10 }); // will score poorly on buy pressure
    const result = await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy({ opportunityScoreMin: 95, riskScoreMax: 5 })], candidateTokens: [weak], killSwitchActive: false, botMode: 'PAPER' },
      ports,
    );
    expect(result.opened).toEqual([]);
  });

  it('processes the highest-ranked candidate first when multiple qualify', async () => {
    const ports = fakePorts();
    const strong = token('Strong', { buys5m: 50, sells5m: 1, liquiditySol: 20 });
    const weaker = token('Weaker', { buys5m: 20, sells5m: 5, liquiditySol: 8 });
    await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy()], candidateTokens: [weaker, strong], killSwitchActive: false, botMode: 'PAPER' },
      ports,
    );
    expect(ports.opened[0]).toBe('Strong');
  });

  it('skips a strategy cleanly (without throwing) when no risk config exists for the user yet', async () => {
    const ports = fakePorts({ getRiskConfig: vi.fn().mockResolvedValue(null) });
    const result = await runAutonomousCycle(
      { userId: 'user1', strategies: [strategy()], candidateTokens: [token('M1')], killSwitchActive: false, botMode: 'PAPER' },
      ports,
    );
    expect(result.skippedNoRiskConfig).toBe(true);
    expect(result.opened).toEqual([]);
  });
});
