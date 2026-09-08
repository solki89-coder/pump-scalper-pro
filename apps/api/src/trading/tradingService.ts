import type { Position, StopLossMode, TakeProfitLevel, Trade, TradeExitReason } from '@pump-scalper/shared';

export interface OpenPositionParams {
  userId: string;
  strategyId: string | null;
  mint: string;
  tokenName: string;
  tokenSymbol: string;
  sizeSol: number;
  currentPriceSol: number;
  liquiditySol: number;
  maxSlippageBps: number;
  stopLossPercent: number;
  stopLossMode: StopLossMode;
  takeProfitLevels: TakeProfitLevel[];
  trailingStopPercent: number | null;
  entryOpportunityScore: number | null;
  entryRiskScore: number | null;
}

export interface ClosePositionParams {
  positionId: string;
  currentPriceSol: number;
  liquiditySol: number;
  maxSlippageBps: number;
  reason: TradeExitReason;
}

export interface SellPartialParams {
  positionId: string;
  quantity: number;
  levelIndex: number | null;
  currentPriceSol: number;
  liquiditySol: number;
  maxSlippageBps: number;
  reason: TradeExitReason;
}

/**
 * The shape both PaperTradingService (this phase) and a future
 * LiveTradingService (Phase 13) implement — PositionMonitor and the
 * Autonomous Engine depend on this interface, never the concrete paper
 * class, so wiring in live execution later is a config change, not a
 * rewrite of the code that decides *when* to trade.
 */
export interface TradingService {
  openPosition(params: OpenPositionParams): Promise<{ position: Position; trade: Trade }>;
  closePosition(params: ClosePositionParams): Promise<{ position: Position; trade: Trade }>;
  sellPartial(params: SellPartialParams): Promise<{ position: Position; trade: Trade }>;
}
