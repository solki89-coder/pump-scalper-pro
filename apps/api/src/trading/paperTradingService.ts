import type { ExecutionEngine } from '@pump-scalper/core';
import type { Position, Trade } from '@pump-scalper/shared';
import type {
  ClosePositionParams,
  OpenPositionParams,
  SellPartialParams,
  TradingService,
} from './tradingService.js';

export interface PositionsPort {
  createPosition(p: Omit<Position, 'id' | 'holdingTimeSeconds'>): Promise<Position>;
  updatePosition(
    id: string,
    patch: Partial<
      Pick<
        Position,
        | 'quantity'
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

/**
 * Simulates a full trade lifecycle (buy fill → position → sell fill → PnL)
 * through the same `ExecutionEngine` interface the live engine implements
 * (Phase 13) — no transaction is ever sent (see PaperExecutionEngine).
 * Every simulated trade is persisted through the same `positions`/`trades`
 * repositories a live trade would use, tagged `mode: 'PAPER'`. Implements
 * `TradingService` so callers (PositionMonitor, the autonomous engine)
 * don't depend on this concrete class.
 */
export class PaperTradingService implements TradingService {
  constructor(
    private readonly engine: ExecutionEngine,
    private readonly positions: PositionsPort,
    private readonly trades: TradesPort,
  ) {}

  async openPosition(params: OpenPositionParams): Promise<{ position: Position; trade: Trade }> {
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
      originalQuantity: fill.quantity,
      entryValueSol: params.sizeSol,
      currentValueSol: fill.quantity * fill.fillPriceSol,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: 0,
      stopLossPercent: params.stopLossPercent,
      stopLossPrice,
      stopLossMode: params.stopLossMode,
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

  async closePosition(params: ClosePositionParams): Promise<{ position: Position; trade: Trade }> {
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

    // Cost basis for the remaining quantity only — a position with earlier
    // partial take-profit sells already realized PnL against the rest.
    const costBasisSol = position.entryValueSol * (position.quantity / position.originalQuantity);
    const pnlSol = fill.sizeSol - costBasisSol;
    const pnlPercent = costBasisSol > 0 ? (pnlSol / costBasisSol) * 100 : 0;
    const closedAt = new Date().toISOString();
    const holdingTimeSeconds = Math.max(0, Math.round((Date.now() - new Date(position.entryTime).getTime()) / 1000));

    const updated = await this.positions.updatePosition(position.id, {
      quantity: 0,
      currentPrice: fill.fillPriceSol,
      highestPrice: Math.max(position.highestPrice, fill.fillPriceSol),
      currentValueSol: 0,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: position.realizedPnlSol + pnlSol,
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

  /**
   * A partial sell — what a take-profit level triggers. `quantity` is
   * capped at the position's remaining quantity, so a slightly-stale caller
   * (e.g. two TP levels firing back to back) can never oversell. Marks
   * `takeProfitLevels[levelIndex]` executed. Closes the position outright
   * if this sell exhausts the remaining quantity (e.g. the last TP level,
   * or a caller-supplied full-remaining amount) rather than leaving a
   * zero-quantity position technically "open".
   */
  async sellPartial(params: SellPartialParams): Promise<{ position: Position; trade: Trade }> {
    const position = await this.positions.getPosition(params.positionId);
    if (!position) throw new Error(`Position ${params.positionId} not found`);
    if (position.status === 'CLOSED') throw new Error(`Position ${params.positionId} is already closed`);

    const sellQuantity = Math.min(params.quantity, position.quantity);
    if (sellQuantity <= 0) throw new Error(`Position ${params.positionId} has no remaining quantity to sell`);

    const fill = await this.engine.executeSell({
      mint: position.mint,
      quantity: sellQuantity,
      currentPriceSol: params.currentPriceSol,
      liquiditySol: params.liquiditySol,
      maxSlippageBps: params.maxSlippageBps,
    });

    const costBasisSol = position.entryValueSol * (sellQuantity / position.originalQuantity);
    const pnlSol = fill.sizeSol - costBasisSol;
    const pnlPercent = costBasisSol > 0 ? (pnlSol / costBasisSol) * 100 : 0;
    const holdingTimeSeconds = Math.max(0, Math.round((Date.now() - new Date(position.entryTime).getTime()) / 1000));

    const remainingQuantity = position.quantity - sellQuantity;
    const closingOut = remainingQuantity <= 1e-9;
    const remainingValueSol = closingOut ? 0 : remainingQuantity * fill.fillPriceSol;
    const remainingCostBasisSol = closingOut ? 0 : position.entryValueSol * (remainingQuantity / position.originalQuantity);

    const takeProfitLevels =
      params.levelIndex === null
        ? position.takeProfitLevels
        : position.takeProfitLevels.map((level, i) =>
            i === params.levelIndex ? { ...level, executed: true, executedAt: new Date().toISOString() } : level,
          );

    const updated = await this.positions.updatePosition(position.id, {
      quantity: closingOut ? 0 : remainingQuantity,
      currentPrice: fill.fillPriceSol,
      highestPrice: Math.max(position.highestPrice, fill.fillPriceSol),
      currentValueSol: remainingValueSol,
      unrealizedPnlSol: closingOut ? 0 : remainingValueSol - remainingCostBasisSol,
      unrealizedPnlPercent: closingOut || remainingCostBasisSol === 0 ? 0 : ((remainingValueSol - remainingCostBasisSol) / remainingCostBasisSol) * 100,
      realizedPnlSol: position.realizedPnlSol + pnlSol,
      takeProfitLevels,
      status: closingOut ? 'CLOSED' : 'OPEN',
      closedAt: closingOut ? new Date().toISOString() : null,
    });
    if (!updated) throw new Error(`Failed to update position ${position.id} on partial sell`);

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
      quantity: sellQuantity,
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
