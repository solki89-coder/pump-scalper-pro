import type { Position, Trade } from '@pump-scalper/shared';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  LiveTradeRecorder,
  TransactionNotConfirmedError,
  type LiveRecorderPositionsPort,
  type LiveRecorderTradesPort,
} from '../src/execution/liveTradeRecorder.js';
import type { ConfirmedSwapDetails, TransactionVerifier } from '../src/execution/onChain.js';

const MINT = 'Mint1111111111111111111111111111111111111';
const USER_ID = randomUUID();
const USER_PUBKEY = 'UserPubkey1111111111111111111111111111111';

function fakeStores() {
  const positions = new Map<string, Position>();
  const trades: Trade[] = [];
  const positionsPort: LiveRecorderPositionsPort = {
    async createPosition(p) {
      const position: Position = { ...p, id: randomUUID(), holdingTimeSeconds: 0 };
      positions.set(position.id, position);
      return position;
    },
    async getPosition(id) {
      return positions.get(id) ?? null;
    },
    async updatePosition(id, patch) {
      const existing = positions.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      positions.set(id, updated);
      return updated;
    },
  };
  const tradesPort: LiveRecorderTradesPort = {
    async createTrade(t) {
      const trade: Trade = { ...t, id: randomUUID(), executedAt: new Date().toISOString() };
      trades.push(trade);
      return trade;
    },
  };
  return { positions, trades, positionsPort, tradesPort };
}

function fakeVerifier(details: ConfirmedSwapDetails | null): TransactionVerifier {
  return { verifySwap: vi.fn().mockResolvedValue(details) };
}

const BUY_PARAMS = {
  userId: USER_ID,
  strategyId: null,
  mint: MINT,
  tokenName: 'Doge Killer',
  tokenSymbol: 'DOGEK',
  userPublicKey: USER_PUBKEY,
  txSignature: 'sig1',
  stopLossPercent: 15,
  stopLossMode: 'FIXED' as const,
  takeProfitLevels: [{ triggerPercent: 10, sellPercent: 50 }],
  trailingStopPercent: null,
  maxSlippageBps: 500,
  entryOpportunityScore: null,
  entryRiskScore: null,
};

describe('LiveTradeRecorder.recordBuy', () => {
  it('derives fill price/quantity/size from the confirmed transaction, never from the request', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const verifier = fakeVerifier({
      slot: 1,
      blockTime: 1_700_000_000,
      solLamportsDelta: -100_000_000, // spent 0.1 SOL
      tokenAmountDelta: 500_000, // received 500,000 tokens
      feesSolPaid: 0.000005,
    });
    const recorder = new LiveTradeRecorder(verifier, positionsPort, tradesPort);

    const { position, trade } = await recorder.recordBuy(BUY_PARAMS);

    expect(position.mode).toBe('LIVE');
    expect(position.quantity).toBe(500_000);
    expect(position.originalQuantity).toBe(500_000);
    expect(position.entryValueSol).toBeCloseTo(0.1, 9);
    expect(position.entryPrice).toBeCloseTo(0.1 / 500_000, 12);
    expect(position.stopLossPrice).toBeCloseTo(position.entryPrice * 0.85, 12);
    expect(trade.side).toBe('BUY');
    expect(trade.txSignature).toBe('sig1');
    expect(trade.feesSol).toBeCloseTo(0.000005, 9);
  });

  it('refuses to record a buy when the transaction verifier finds nothing (not confirmed / not found)', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const recorder = new LiveTradeRecorder(fakeVerifier(null), positionsPort, tradesPort);
    await expect(recorder.recordBuy(BUY_PARAMS)).rejects.toThrow(TransactionNotConfirmedError);
  });

  it('refuses to record a buy when the transaction shows tokens leaving instead of arriving', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const verifier = fakeVerifier({ slot: 1, blockTime: 1, solLamportsDelta: -100, tokenAmountDelta: -5, feesSolPaid: 0 });
    const recorder = new LiveTradeRecorder(verifier, positionsPort, tradesPort);
    await expect(recorder.recordBuy(BUY_PARAMS)).rejects.toThrow(TransactionNotConfirmedError);
  });
});

describe('LiveTradeRecorder.recordSell', () => {
  async function openLivePosition(positionsPort: LiveRecorderPositionsPort) {
    return positionsPort.createPosition({
      userId: USER_ID,
      strategyId: null,
      mode: 'LIVE',
      status: 'OPEN',
      mint: MINT,
      tokenName: 'Doge Killer',
      tokenSymbol: 'DOGEK',
      entryPrice: 0.0000002,
      currentPrice: 0.0000002,
      highestPrice: 0.0000002,
      quantity: 500_000,
      originalQuantity: 500_000,
      entryValueSol: 0.1,
      currentValueSol: 0.1,
      unrealizedPnlSol: 0,
      unrealizedPnlPercent: 0,
      realizedPnlSol: 0,
      stopLossPercent: 15,
      stopLossPrice: 0.00000017,
      stopLossMode: 'FIXED',
      takeProfitLevels: [{ triggerPercent: 10, sellPercent: 50, executed: false, executedAt: null }],
      trailingStopPercent: null,
      trailingStopPrice: null,
      entryOpportunityScore: null,
      entryRiskScore: null,
      entryTime: new Date().toISOString(),
      closedAt: null,
    });
  }

  it('closes the position outright when the full remaining quantity is sold', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const position = await openLivePosition(positionsPort);
    const verifier = fakeVerifier({
      slot: 2,
      blockTime: 1_700_001_000,
      solLamportsDelta: 130_000_000, // received 0.13 SOL
      tokenAmountDelta: -500_000,
      feesSolPaid: 0.000005,
    });
    const recorder = new LiveTradeRecorder(verifier, positionsPort, tradesPort);

    const { position: closed, trade } = await recorder.recordSell({
      positionId: position.id,
      userPublicKey: USER_PUBKEY,
      txSignature: 'sig2',
      quantity: 500_000,
      levelIndex: null,
      maxSlippageBps: 500,
      reason: 'MANUAL',
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.quantity).toBe(0);
    expect(trade.pnlSol).toBeCloseTo(0.03, 9); // 0.13 proceeds - 0.1 cost basis
  });

  it('leaves the position open with a reduced quantity on a partial sell, marking the TP level executed', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const position = await openLivePosition(positionsPort);
    const verifier = fakeVerifier({
      slot: 2,
      blockTime: 1_700_001_000,
      solLamportsDelta: 65_000_000, // received 0.065 SOL for half
      tokenAmountDelta: -250_000,
      feesSolPaid: 0.000005,
    });
    const recorder = new LiveTradeRecorder(verifier, positionsPort, tradesPort);

    const { position: after } = await recorder.recordSell({
      positionId: position.id,
      userPublicKey: USER_PUBKEY,
      txSignature: 'sig2',
      quantity: 250_000,
      levelIndex: 0,
      maxSlippageBps: 500,
      reason: 'TAKE_PROFIT',
    });

    expect(after.status).toBe('OPEN');
    expect(after.quantity).toBe(250_000);
    expect(after.takeProfitLevels[0]?.executed).toBe(true);
    expect(after.realizedPnlSol).toBeCloseTo(0.015, 9); // 0.065 proceeds - 0.05 cost basis
  });

  it('refuses to record a sell for an already-closed position', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const position = await openLivePosition(positionsPort);
    await positionsPort.updatePosition(position.id, { status: 'CLOSED', quantity: 0 });
    const recorder = new LiveTradeRecorder(fakeVerifier(null), positionsPort, tradesPort);
    await expect(
      recorder.recordSell({
        positionId: position.id,
        userPublicKey: USER_PUBKEY,
        txSignature: 'sig2',
        quantity: 1,
        levelIndex: null,
        maxSlippageBps: 500,
        reason: 'MANUAL',
      }),
    ).rejects.toThrow('already closed');
  });

  it('refuses to record a sell when the verifier finds a token INCREASE instead of a decrease', async () => {
    const { positionsPort, tradesPort } = fakeStores();
    const position = await openLivePosition(positionsPort);
    const verifier = fakeVerifier({ slot: 2, blockTime: 1, solLamportsDelta: 100, tokenAmountDelta: 5, feesSolPaid: 0 });
    const recorder = new LiveTradeRecorder(verifier, positionsPort, tradesPort);
    await expect(
      recorder.recordSell({
        positionId: position.id,
        userPublicKey: USER_PUBKEY,
        txSignature: 'sig2',
        quantity: 1,
        levelIndex: null,
        maxSlippageBps: 500,
        reason: 'MANUAL',
      }),
    ).rejects.toThrow(TransactionNotConfirmedError);
  });
});
