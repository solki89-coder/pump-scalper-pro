import type { RiskConfig } from '@pump-scalper/shared';
import { describe, expect, it } from 'vitest';
import { checkTrade, type RiskCheckInput } from '../../src/risk/riskEngine.js';

const baseConfig: RiskConfig = {
  userId: '11111111-1111-1111-1111-111111111111',
  maxPositionSizeSol: 0.5,
  maxDailyLossSol: 1,
  maxTotalExposureSol: 2,
  maxOpenPositions: 3,
  maxTradesPerDay: 20,
  maxSlippageBps: 500,
  minSolBalance: 0.1,
  autonomousEnabled: false,
  autonomousMaxPositionSol: null,
  autonomousMaxDailyLossSol: null,
  autonomousMaxTrades: null,
  tradingAllocationSol: 2,
};

const baseInput: RiskCheckInput = {
  mode: 'PAPER',
  isAutonomous: false,
  sizeSol: 0.1,
  slippageBps: 100,
  currentSolBalance: 5,
  openPositionsCount: 0,
  currentTotalExposureSol: 0,
  tradesTodayCount: 0,
  realizedDailyLossSol: 0,
  killSwitchActive: false,
  liveTradingEnabled: false,
};

describe('checkTrade', () => {
  it('approves a well-within-limits paper trade', () => {
    const result = checkTrade(baseInput, baseConfig);
    expect(result).toMatchObject({ approved: true, reasons: [] });
  });

  it('rejects when the kill switch is active, above every other check', () => {
    const result = checkTrade({ ...baseInput, killSwitchActive: true }, baseConfig);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain('KILL_SWITCH_ACTIVE');
  });

  it('rejects a LIVE trade when live trading is not enabled, but never a PAPER trade for that reason', () => {
    const live = checkTrade({ ...baseInput, mode: 'LIVE', liveTradingEnabled: false }, baseConfig);
    expect(live.reasons).toContain('LIVE_TRADING_DISABLED');
    const paper = checkTrade({ ...baseInput, mode: 'PAPER', liveTradingEnabled: false }, baseConfig);
    expect(paper.reasons).not.toContain('LIVE_TRADING_DISABLED');
  });

  it('allows a LIVE trade when live trading is explicitly enabled and every other check passes', () => {
    const result = checkTrade({ ...baseInput, mode: 'LIVE', liveTradingEnabled: true }, baseConfig);
    expect(result.approved).toBe(true);
  });

  it('rejects a trade larger than maxPositionSizeSol', () => {
    const result = checkTrade({ ...baseInput, sizeSol: 0.6 }, baseConfig);
    expect(result.reasons).toContain('MAX_POSITION_SIZE');
  });

  it('rejects when the trade would drop the balance below minSolBalance', () => {
    const result = checkTrade({ ...baseInput, currentSolBalance: 0.15, sizeSol: 0.1 }, baseConfig);
    expect(result.reasons).toContain('MIN_SOL_BALANCE');
  });

  it('rejects when already at maxOpenPositions', () => {
    const result = checkTrade({ ...baseInput, openPositionsCount: 3 }, baseConfig);
    expect(result.reasons).toContain('MAX_OPEN_POSITIONS');
  });

  it('rejects when already at maxTradesPerDay', () => {
    const result = checkTrade({ ...baseInput, tradesTodayCount: 20 }, baseConfig);
    expect(result.reasons).toContain('MAX_TRADES_PER_DAY');
  });

  it('rejects when the trade slippage exceeds maxSlippageBps', () => {
    const result = checkTrade({ ...baseInput, slippageBps: 600 }, baseConfig);
    expect(result.reasons).toContain('MAX_SLIPPAGE');
  });

  it('rejects when adding this trade would exceed maxTotalExposureSol', () => {
    const result = checkTrade({ ...baseInput, currentTotalExposureSol: 1.95, sizeSol: 0.1 }, baseConfig);
    expect(result.reasons).toContain('MAX_TOTAL_EXPOSURE');
  });

  it('rejects when daily realized loss has reached maxDailyLossSol', () => {
    const result = checkTrade({ ...baseInput, realizedDailyLossSol: 1 }, baseConfig);
    expect(result.reasons).toContain('MAX_DAILY_LOSS');
  });

  it('rejects when adding this trade would exceed the trading allocation, even with room under maxTotalExposureSol', () => {
    const config = { ...baseConfig, tradingAllocationSol: 0.15, maxTotalExposureSol: 5 };
    const result = checkTrade({ ...baseInput, currentTotalExposureSol: 0.1, sizeSol: 0.1 }, config);
    expect(result.reasons).toContain('TRADING_ALLOCATION_EXCEEDED');
  });

  it('collects every failing reason at once rather than short-circuiting on the first', () => {
    const result = checkTrade(
      { ...baseInput, sizeSol: 10, currentSolBalance: 0, openPositionsCount: 3, tradesTodayCount: 20 },
      baseConfig,
    );
    expect(result.reasons).toEqual(
      expect.arrayContaining(['MAX_POSITION_SIZE', 'MIN_SOL_BALANCE', 'MAX_OPEN_POSITIONS', 'MAX_TRADES_PER_DAY']),
    );
  });

  describe('autonomous trades', () => {
    it('rejects any autonomous trade when autonomousEnabled is false, even if it would otherwise pass', () => {
      const result = checkTrade({ ...baseInput, isAutonomous: true }, baseConfig);
      expect(result.reasons).toContain('AUTONOMOUS_DISABLED');
    });

    it('never applies AUTONOMOUS_DISABLED to a manual trade', () => {
      const result = checkTrade({ ...baseInput, isAutonomous: false }, baseConfig);
      expect(result.reasons).not.toContain('AUTONOMOUS_DISABLED');
    });

    it('rejects when the autonomous-specific position cap is exceeded even though the general cap allows it', () => {
      const config = { ...baseConfig, autonomousEnabled: true, autonomousMaxPositionSol: 0.05 };
      const result = checkTrade({ ...baseInput, isAutonomous: true, sizeSol: 0.1 }, config); // under maxPositionSizeSol(0.5) but over autonomous cap
      expect(result.reasons).toContain('AUTONOMOUS_MAX_POSITION');
    });

    it('rejects when autonomous daily loss cap is reached, independent of the general daily loss cap', () => {
      const config = { ...baseConfig, autonomousEnabled: true, autonomousMaxDailyLossSol: 0.2 };
      const result = checkTrade({ ...baseInput, isAutonomous: true, realizedDailyLossSol: 0.25 }, config);
      expect(result.reasons).toContain('AUTONOMOUS_MAX_DAILY_LOSS');
      expect(result.reasons).not.toContain('MAX_DAILY_LOSS'); // general cap of 1 SOL not reached
    });

    it('rejects when autonomous trade count cap is reached, independent of the general trade count cap', () => {
      const config = { ...baseConfig, autonomousEnabled: true, autonomousMaxTrades: 2 };
      const result = checkTrade({ ...baseInput, isAutonomous: true, tradesTodayCount: 2 }, config);
      expect(result.reasons).toContain('AUTONOMOUS_MAX_TRADES');
    });

    it('approves a well-formed autonomous trade once autonomousEnabled and all caps are satisfied', () => {
      const config = {
        ...baseConfig,
        autonomousEnabled: true,
        autonomousMaxPositionSol: 0.5,
        autonomousMaxDailyLossSol: 1,
        autonomousMaxTrades: 20,
      };
      const result = checkTrade({ ...baseInput, isAutonomous: true }, config);
      expect(result.approved).toBe(true);
    });
  });
});
