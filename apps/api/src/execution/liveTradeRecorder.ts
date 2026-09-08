import type { Position, StopLossMode, TakeProfitLevel, Trade, TradeExitReason } from '@pump-scalper/shared';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { NoopTelegramAlerts, type TelegramAlertsPort } from '../telegram/alerts.js';
import type { TransactionVerifier } from './onChain.js';

export interface LiveRecorderPositionsPort {
  createPosition(p: Omit<Position, 'id' | 'holdingTimeSeconds'>): Promise<Position>;
  getPosition(id: string): Promise<Position | null>;
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
        | 'takeProfitLevels'
        | 'status'
        | 'closedAt'
      >
    >,
  ): Promise<Position | null>;
}

export interface LiveRecorderTradesPort {
  createTrade(t: Omit<Trade, 'id' | 'executedAt'>): Promise<Trade>;
}

export interface RecordLiveBuyParams {
  userId: string;
  strategyId: string | null;
  mint: string;
  tokenName: string;
  tokenSymbol: string;
  userPublicKey: string;
  txSignature: string;
  stopLossPercent: number;
  stopLossMode: StopLossMode;
  takeProfitLevels: TakeProfitLevel[];
  trailingStopPercent: number | null;
  maxSlippageBps: number;
  entryOpportunityScore: number | null;
  entryRiskScore: number | null;
}

export interface RecordLiveSellParams {
  positionId: string;
  userPublicKey: string;
  txSignature: string;
  quantity: number;
  levelIndex: number | null;
  maxSlippageBps: number;
  reason: TradeExitReason;
}

export class TransactionNotConfirmedError extends Error {
  constructor(signature: string) {
    super(`Transaction ${signature} was not found, not confirmed, or failed on-chain — refusing to record a trade for it.`);
    this.name = 'TransactionNotConfirmedError';
  }
}

/**
 * Records a LIVE trade AFTER it has already happened on-chain (the browser
 * signed and sent it via Phantom — see apps/web/src/lib/wallet). Never
 * trusts the request body for price/quantity/fees: everything is read
 * back from the confirmed transaction itself via TransactionVerifier, so
 * a caller cannot report a fill that didn't actually occur.
 */
export class LiveTradeRecorder {
  constructor(
    private readonly verifier: TransactionVerifier,
    private readonly positions: LiveRecorderPositionsPort,
    private readonly trades: LiveRecorderTradesPort,
    private readonly alerts: TelegramAlertsPort = new NoopTelegramAlerts(),
  ) {}

  async recordBuy(params: RecordLiveBuyParams): Promise<{ position: Position; trade: Trade }> {
    const details = await this.verifier.verifySwap(params.txSignature, params.userPublicKey, params.mint);
    if (!details || details.tokenAmountDelta <= 0 || details.solLamportsDelta >= 0) {
      throw new TransactionNotConfirmedError(params.txSignature);
    }

    const quantity = details.tokenAmountDelta;
    const sizeSol = -details.solLamportsDelta / LAMPORTS_PER_SOL;
    const fillPrice = sizeSol / quantity;
    const stopLossPrice = fillPrice * (1 - params.stopLossPercent / 100);
    const entryTime = details.blockTime ? new Date(details.blockTime * 1000).toISOString() : new Date().toISOString();

    const position = await this.positions.createPosition({
      userId: params.userId,
      strategyId: params.strategyId,
      mode: 'LIVE',
      status: 'OPEN',
      mint: params.mint,
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      highestPrice: fillPrice,
      quantity,
      originalQuantity: quantity,
      entryValueSol: sizeSol,
      currentValueSol: sizeSol,
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
      mode: 'LIVE',
      mint: params.mint,
      tokenName: params.tokenName,
      tokenSymbol: params.tokenSymbol,
      side: 'BUY',
      price: fillPrice,
      quantity,
      sizeSol,
      feesSol: details.feesSolPaid,
      slippageBps: params.maxSlippageBps,
      pnlSol: null,
      pnlPercent: null,
      exitReason: null,
      holdingTimeSeconds: null,
      entryOpportunityScore: params.entryOpportunityScore,
      entryRiskScore: params.entryRiskScore,
      txSignature: params.txSignature,
    });

    void this.alerts.buyExecuted(position);
    return { position, trade };
  }

  async recordSell(params: RecordLiveSellParams): Promise<{ position: Position; trade: Trade }> {
    const position = await this.positions.getPosition(params.positionId);
    if (!position) throw new Error(`Position ${params.positionId} not found`);
    if (position.status === 'CLOSED') throw new Error(`Position ${params.positionId} is already closed`);

    const details = await this.verifier.verifySwap(params.txSignature, params.userPublicKey, position.mint);
    if (!details || details.tokenAmountDelta >= 0 || details.solLamportsDelta <= 0) {
      throw new TransactionNotConfirmedError(params.txSignature);
    }

    const soldQuantity = -details.tokenAmountDelta;
    const proceedsSol = details.solLamportsDelta / LAMPORTS_PER_SOL;
    const fillPrice = proceedsSol / soldQuantity;
    const costBasisSol = position.entryValueSol * (soldQuantity / position.originalQuantity);
    const pnlSol = proceedsSol - costBasisSol;
    const pnlPercent = costBasisSol > 0 ? (pnlSol / costBasisSol) * 100 : 0;
    const holdingTimeSeconds = Math.max(
      0,
      Math.round(((details.blockTime ? details.blockTime * 1000 : Date.now()) - new Date(position.entryTime).getTime()) / 1000),
    );

    const remainingQuantity = Math.max(0, position.quantity - soldQuantity);
    const closingOut = remainingQuantity <= 1e-9;
    const remainingValueSol = closingOut ? 0 : remainingQuantity * fillPrice;
    const remainingCostBasisSol = closingOut ? 0 : position.entryValueSol * (remainingQuantity / position.originalQuantity);

    const takeProfitLevels =
      params.levelIndex === null
        ? position.takeProfitLevels
        : position.takeProfitLevels.map((level, i) =>
            i === params.levelIndex ? { ...level, executed: true, executedAt: new Date().toISOString() } : level,
          );

    const updated = await this.positions.updatePosition(position.id, {
      quantity: closingOut ? 0 : remainingQuantity,
      currentPrice: fillPrice,
      highestPrice: Math.max(position.highestPrice, fillPrice),
      currentValueSol: remainingValueSol,
      unrealizedPnlSol: closingOut ? 0 : remainingValueSol - remainingCostBasisSol,
      unrealizedPnlPercent: closingOut || remainingCostBasisSol === 0 ? 0 : ((remainingValueSol - remainingCostBasisSol) / remainingCostBasisSol) * 100,
      realizedPnlSol: position.realizedPnlSol + pnlSol,
      takeProfitLevels,
      status: closingOut ? 'CLOSED' : 'OPEN',
      closedAt: closingOut ? new Date().toISOString() : null,
    });
    if (!updated) throw new Error(`Failed to update position ${position.id}`);

    const trade = await this.trades.createTrade({
      userId: position.userId,
      positionId: position.id,
      strategyId: position.strategyId,
      mode: 'LIVE',
      mint: position.mint,
      tokenName: position.tokenName,
      tokenSymbol: position.tokenSymbol,
      side: 'SELL',
      price: fillPrice,
      quantity: soldQuantity,
      sizeSol: proceedsSol,
      feesSol: details.feesSolPaid,
      slippageBps: params.maxSlippageBps,
      pnlSol,
      pnlPercent,
      exitReason: params.reason,
      holdingTimeSeconds,
      entryOpportunityScore: position.entryOpportunityScore,
      entryRiskScore: position.entryRiskScore,
      txSignature: params.txSignature,
    });

    void this.alerts.sellExecuted(updated, trade);
    return { position: updated, trade };
  }
}
