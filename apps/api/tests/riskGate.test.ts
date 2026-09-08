import type { RiskConfig } from '@pump-scalper/shared';
import { describe, expect, it, vi } from 'vitest';
import { evaluateTrade, type RiskGatePorts, type TradeRequest } from '../src/risk/riskGate.js';

const riskConfig: RiskConfig = {
  userId: 'user1',
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

function fakePorts(overrides: Partial<RiskGatePorts> = {}): RiskGatePorts {
  return {
    getBotState: vi.fn().mockResolvedValue({ killSwitchActive: false }),
    countOpenPositions: vi.fn().mockResolvedValue(0),
    sumOpenExposureSol: vi.fn().mockResolvedValue(0),
    countTradesToday: vi.fn().mockResolvedValue(0),
    sumRealizedPnlSince: vi.fn().mockResolvedValue(0),
    recordRiskEvent: vi.fn().mockResolvedValue(undefined),
    isLiveTradingEnabled: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

const baseRequest: TradeRequest = {
  userId: 'user1',
  mint: 'Mint1',
  strategyId: null,
  mode: 'PAPER',
  isAutonomous: false,
  sizeSol: 0.1,
  slippageBps: 100,
  currentSolBalance: 5,
};

describe('evaluateTrade', () => {
  it('approves a trade well within every limit and records nothing', async () => {
    const ports = fakePorts();
    const result = await evaluateTrade(baseRequest, riskConfig, ports);
    expect(result.approved).toBe(true);
    expect(ports.recordRiskEvent).not.toHaveBeenCalled();
  });

  it('rejects and records a risk_event when the kill switch is active', async () => {
    const ports = fakePorts({ getBotState: vi.fn().mockResolvedValue({ killSwitchActive: true }) });
    const result = await evaluateTrade(baseRequest, riskConfig, ports);
    expect(result.approved).toBe(false);
    expect(result.reasons).toContain('KILL_SWITCH_ACTIVE');
    expect(ports.recordRiskEvent).toHaveBeenCalledTimes(1);
    expect(ports.recordRiskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user1', mint: 'Mint1', reasons: expect.arrayContaining(['KILL_SWITCH_ACTIVE']) }),
    );
  });

  it('pulls open positions, exposure, trades-today, and daily PnL from the ports before deciding', async () => {
    const ports = fakePorts({
      countOpenPositions: vi.fn().mockResolvedValue(3), // at the cap
    });
    const result = await evaluateTrade(baseRequest, riskConfig, ports);
    expect(result.reasons).toContain('MAX_OPEN_POSITIONS');
  });

  it('converts negative realized PnL into a positive daily-loss figure for the risk check', async () => {
    const ports = fakePorts({ sumRealizedPnlSince: vi.fn().mockResolvedValue(-1.5) }); // lost 1.5 SOL today
    const result = await evaluateTrade(baseRequest, riskConfig, { ...ports });
    expect(result.reasons).toContain('MAX_DAILY_LOSS'); // cap is 1 SOL
  });

  it('does not apply MAX_DAILY_LOSS when today is net positive', async () => {
    const ports = fakePorts({ sumRealizedPnlSince: vi.fn().mockResolvedValue(2) }); // up 2 SOL today
    const result = await evaluateTrade(baseRequest, riskConfig, ports);
    expect(result.reasons).not.toContain('MAX_DAILY_LOSS');
  });

  it('reads live-trading-enabled from the ports, not a hardcoded default', async () => {
    const ports = fakePorts({ isLiveTradingEnabled: vi.fn().mockReturnValue(true) });
    const result = await evaluateTrade({ ...baseRequest, mode: 'LIVE' }, riskConfig, ports);
    expect(result.reasons).not.toContain('LIVE_TRADING_DISABLED');
  });
});
