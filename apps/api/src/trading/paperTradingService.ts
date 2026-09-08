import type { ExecutionEngine } from '@pump-scalper/core';
import type { Position, TakeProfitLevel, Trade, TradeExitReason } from '@pump-scalper/shared';

export interface PositionsPort {
  createPosition(p: Omit<Position, 'id' | 'holdingTimeSeconds'>): Promise<Position>;
  updatePosition(
    id: string,
    patch: Partial<
      Pick<
        Position,
        | 'currentPrice'
        | 'highestPrice'
        | 'currentValueSol'
        | 'unrealizedPnlSol'
        | 'unrealizedPnlPercent'
        | 'realizedPnlSol'
        | 'stopLossPrice'
        | 'takeProfitLevels'
        | 'trailingStopPrice'
        | 'status'
        | 'closedAt'
      >
    >,
  ): Promise<Position | null>;
  getPosition(id: string): Promise<Position | null>;
}

export interface TradesPort {
  createTrade(t: Omit<Trade, 'id' | 'executedAt'>): Promise<Trade>;
}

export interface OpenPaperPositionParams {
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
  takeProfitLevels: TakeProfitLevel[];
  trailingStopPercent: number | null;
  entryOpportunityScore: number | null;
  entryRiskScore: number | null;
}

export interface ClosePaperPositionParams {
  positionId: string;
  currentPriceSol: number;
  liquiditySol: number;
  maxSlippageBps: number;
  reason: TradeExitReason;
}

/**
 * Simulates a full trade lifecycle (buy fill → position → sell fill → PnL)
 * through the same `ExecutionEngine` interface the live engine implements
 * (Phase 13) — no transaction is ever sent (see PaperExecutionEngine).
 * Every simulated trade is persisted through the same `positions`/`trades`
 * repositories a live trade would use, tagged `mode: 'PAPER'`.
 */
export class PaperTradingService {
  constructor(
    private readonly engine: ExecutionEngine,
    private readonly positions: PositionsPort,
    private readonly trades: TradesPort,
  ) {}

  async openPosition(params: OpenPaperPositionParams): Promise<{ position: Position; trade: Trade }> {
    const fill = await this.engine.executeBuy({
      mint: params.mint,
      sizeSol: params.sizeSol,
      currentPriceSol: params.currentPriceSol,
      liquiditySol: params.liquiditySol,
      maxSlippageBps: params.maxSlippageBps,
    });

    const stopLossPrice = fill.fillPriceSol * (1 - params.stopLossPercent / 100);
    const entryTime = new Date().toISOString();

    const position = await this.positions.createPosition({
      userId: params.userId,
      strategyId: params.strategyId,
      mode: 'PAPER',
      status: 'OPEN',
      mint: params.mint,
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      entryPrice: fill.fillPriceSol,
      currentPrice: fill.fillPriceSol,
      highestPrice: fill.fillPriceSol,
      quantity: fill.quantity,
      entryValueSol: params.sizeSol,
      currentValueSol: fill.quantity * fill.fillPriceSol,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: 0,
      stopLossPercent: params.stopLossPercent,
      stopLossPrice,
      takeProfitLevels: params.takeProfitLevels.map((l) => ({ ...l, executed: false, executedAt: null })),
      trailingStopPercent: params.trailingStopPercent,
      trailingStopPrice: null,
      entryOpportunityScore: params.entryOpportunityScore,
      entryRiskScore: params.entryRiskScore,
      entryTime,
      closedAt: null,
    });

    const trade = await this.trades.createTrade({
      userId: params.userId,
      positionId: position.id,
      strategyId: params.strategyId,
      mode: 'PAPER',
      mint: params.mint,
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      side: 'BUY',
      price: fill.fillPriceSol,
      quantity: fill.quantity,
      sizeSol: params.sizeSol,
      feesSol: fill.feesSol,
      slippageBps: fill.slippageBps,
      pnlSol: null,
      pnlPercent: null,
      exitReason: null,
      holdingTimeSeconds: null,
      entryOpportunityScore: params.entryOpportunityScore,
      entryRiskScore: params.entryRiskScore,
      txSignature: null,
    });

    return { position, trade };
  }

  async closePosition(params: ClosePaperPositionParams): Promise<{ position: Position; trade: Trade }> {
    const position = await this.positions.getPosition(params.positionId);
    if (!position) throw new Error(`Position ${params.positionId} not found`);
    if (position.status === 'CLOSED') throw new Error(`Position ${params.positionId} is already closed`);

    const fill = await this.engine.executeSell({
      mint: position.mint,
      quantity: position.quantity,
      currentPriceSol: params.currentPriceSol,
      liquiditySol: params.liquiditySol,
      maxSlippageBps: params.maxSlippageBps,
    });

    const pnlSol = fill.sizeSol - position.entryValueSol;
    const pnlPercent = position.entryValueSol > 0 ? (pnlSol / position.entryValueSol) * 100 : 0;
    const closedAt = new Date().toISOString();
    const holdingTimeSeconds = Math.max(0, Math.round((Date.now() - new Date(position.entryTime).getTime()) / 1000));

    const updated = await this.positions.updatePosition(position.id, {
      currentPrice: fill.fillPriceSol,
      highestPrice: Math.max(position.highestPrice, fill.fillPriceSol),
      currentValueSol: fill.sizeSol,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: pnlSol,
      status: 'CLOSED',
      closedAt,
    });
    if (!updated) throw new Error(`Failed to update position ${position.id} on close`);

    const trade = await this.trades.createTrade({
      userId: position.userId,
      positionId: position.id,
      strategyId: position.strategyId,
      mode: 'PAPER',
      mint: position.mint,
      tokenName: position.tokenName,
      tokenSymbol: position.tokenSymbol,
      side: 'SELL',
      price: fill.fillPriceSol,
      quantity: fill.quantity,
      sizeSol: fill.sizeSol,
      feesSol: fill.feesSol,
      slippageBps: fill.slippageBps,
      pnlSol,
      pnlPercent,
      exitReason: params.reason,
      holdingTimeSeconds,
      entryOpportunityScore: position.entryOpportunityScore,
      entryRiskScore: position.entryRiskScore,
      txSignature: null,
    });

    return { position: updated, trade };
  }
}
