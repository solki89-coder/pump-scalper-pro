import { StopLossModeSchema, TakeProfitLevelSchema, TradeExitReasonSchema } from '@pump-scalper/shared';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createPosition, getPosition, updatePosition } from '../db/repositories/positions.js';
import { getRiskConfig } from '../db/repositories/riskConfig.js';
import { getToken } from '../db/repositories/tokens.js';
import { createTrade } from '../db/repositories/trades.js';
import { listWallets } from '../db/repositories/wallets.js';
import { JupiterSwapAdapter, WRAPPED_SOL_MINT } from '../execution/jupiterSwapAdapter.js';
import { LiveTradeRecorder, TransactionNotConfirmedError } from '../execution/liveTradeRecorder.js';
import { getMintDecimals, SolanaTransactionVerifier } from '../execution/onChain.js';
import { evaluateTrade } from '../risk/index.js';
import { getConnection } from '../solana.js';
import { getTelegramAlerts } from '../telegram/index.js';

/**
 * Phase 14 security audit: on-chain signer verification (see
 * SolanaTransactionVerifier) proves a transaction was actually authorized
 * by `userPublicKey` — but without this check, an authenticated caller
 * could still name *any* real wallet's public key (public information —
 * every Solana address and every transaction it ever signed is visible on
 * any block explorer) as `userPublicKey` and have that stranger's
 * genuine, unrelated swap recorded as their own trade. Requiring the key
 * to be one this account actually connected via POST /api/wallet/connect
 * ties the on-chain proof back to *this* account, not just to *some*
 * real wallet.
 */
async function ownsConnectedWallet(userId: string, publicKey: string): Promise<boolean> {
  const wallets = await listWallets(userId);
  return wallets.some((w) => w.connected && w.publicKey === publicKey);
}

const PublicKeySchema = z.string().refine((v) => {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
}, 'Not a valid Solana public key');

const QuoteRequestSchema = z.object({
  mint: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  sizeSol: z.number().positive().optional(),
  quantity: z.number().positive().optional(),
  maxSlippageBps: z.number().int().nonnegative(),
  userPublicKey: PublicKeySchema,
});

const ConfirmRequestSchema = z.object({
  mint: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  txSignature: z.string().min(1),
  userPublicKey: PublicKeySchema,
  maxSlippageBps: z.number().int().nonnegative(),
  // BUY-only fields
  strategyId: z.string().uuid().nullable().default(null),
  stopLossPercent: z.number().positive().optional(),
  stopLossMode: StopLossModeSchema.default('FIXED'),
  takeProfitLevels: z.array(TakeProfitLevelSchema).default([]),
  trailingStopPercent: z.number().positive().nullable().default(null),
  // SELL-only fields
  positionId: z.string().uuid().optional(),
  quantity: z.number().positive().optional(),
  levelIndex: z.number().int().nonnegative().nullable().default(null),
  reason: TradeExitReasonSchema.default('MANUAL'),
});

/**
 * Manual LIVE trading only — the browser's own Phantom connection signs
 * every transaction, per the project decision that autonomous trading
 * never gets LIVE (there is no way to get per-trade human approval on an
 * automated loop). This is a two-step flow, not a single call, because
 * signing has to happen in the browser: `quote` returns an unsigned
 * transaction for the connected wallet to sign; `confirm` is called after
 * the browser has broadcast it, and re-derives the actual fill from the
 * confirmed on-chain transaction rather than trusting the request.
 */
export default async function executionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/execution/quote', { preHandler: fastify.authenticate }, async (request, reply) => {
    const config = loadConfig();
    if (!config.ENABLE_LIVE_TRADING) {
      return reply.code(403).send({ error: 'ENABLE_LIVE_TRADING is not set to true. Live execution is disabled.' });
    }
    const parsed = QuoteRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    const body = parsed.data;

    if (!(await ownsConnectedWallet(request.userId, body.userPublicKey))) {
      return reply.code(403).send({ error: 'That public key is not a wallet connected to your account. Connect it via POST /api/wallet/connect first.' });
    }

    const riskConfig = await getRiskConfig(request.userId);
    if (!riskConfig) return reply.code(409).send({ error: 'No risk configuration set for this user yet.' });

    const connection = getConnection();
    const jupiter = new JupiterSwapAdapter(config.JUPITER_API_BASE);

    if (body.side === 'BUY') {
      if (!body.sizeSol) return reply.code(400).send({ error: 'sizeSol is required for a BUY quote' });

      const balanceLamports = await connection.getBalance(new PublicKey(body.userPublicKey));
      const riskResult = await evaluateTrade(
        {
          userId: request.userId,
          mint: body.mint,
          strategyId: null,
          mode: 'LIVE',
          isAutonomous: false,
          sizeSol: body.sizeSol,
          slippageBps: body.maxSlippageBps,
          currentSolBalance: balanceLamports / LAMPORTS_PER_SOL,
        },
        riskConfig,
      );
      if (!riskResult.approved) {
        return reply.code(403).send({ error: 'Rejected by Risk Engine', reasons: riskResult.reasons });
      }

      const amountLamports = Math.round(body.sizeSol * LAMPORTS_PER_SOL);
      const quote = await jupiter.getQuote({
        inputMint: WRAPPED_SOL_MINT,
        outputMint: body.mint,
        amountBaseUnits: amountLamports,
        slippageBps: body.maxSlippageBps,
      });
      const transactionBase64 = await jupiter.buildSwapTransaction(quote, body.userPublicKey);
      return { quote, transactionBase64 };
    }

    // SELL — no risk gate: selling only reduces exposure (same reasoning as positionMonitor.ts).
    if (!body.quantity) return reply.code(400).send({ error: 'quantity is required for a SELL quote' });
    const decimals = await getMintDecimals(connection, body.mint);
    const amountBaseUnits = Math.round(body.quantity * 10 ** decimals);
    const quote = await jupiter.getQuote({
      inputMint: body.mint,
      outputMint: WRAPPED_SOL_MINT,
      amountBaseUnits,
      slippageBps: body.maxSlippageBps,
    });
    const transactionBase64 = await jupiter.buildSwapTransaction(quote, body.userPublicKey);
    return { quote, transactionBase64 };
  });

  fastify.post('/api/execution/confirm', { preHandler: fastify.authenticate }, async (request, reply) => {
    const config = loadConfig();
    if (!config.ENABLE_LIVE_TRADING) {
      return reply.code(403).send({ error: 'ENABLE_LIVE_TRADING is not set to true. Live execution is disabled.' });
    }
    const parsed = ConfirmRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    const body = parsed.data;

    if (!(await ownsConnectedWallet(request.userId, body.userPublicKey))) {
      return reply.code(403).send({ error: 'That public key is not a wallet connected to your account. Connect it via POST /api/wallet/connect first.' });
    }

    const recorder = new LiveTradeRecorder(
      new SolanaTransactionVerifier(getConnection()),
      { createPosition, getPosition, updatePosition },
      { createTrade },
      getTelegramAlerts(),
    );

    try {
      if (body.side === 'BUY') {
        if (!body.stopLossPercent) return reply.code(400).send({ error: 'stopLossPercent is required to confirm a BUY' });
        const token = await getToken(body.mint);
        if (!token) return reply.code(404).send({ error: `Unknown mint ${body.mint}` });

        const { position, trade } = await recorder.recordBuy({
          userId: request.userId,
          strategyId: body.strategyId,
          mint: body.mint,
          tokenName: token.name,
          tokenSymbol: token.symbol,
          userPublicKey: body.userPublicKey,
          txSignature: body.txSignature,
          stopLossPercent: body.stopLossPercent,
          stopLossMode: body.stopLossMode,
          takeProfitLevels: body.takeProfitLevels,
          trailingStopPercent: body.trailingStopPercent,
          maxSlippageBps: body.maxSlippageBps,
          entryOpportunityScore: null,
          entryRiskScore: null,
        });
        return reply.code(201).send({ position, trade });
      }

      if (!body.positionId || !body.quantity) {
        return reply.code(400).send({ error: 'positionId and quantity are required to confirm a SELL' });
      }
      const existing = await getPosition(body.positionId);
      if (!existing || existing.userId !== request.userId) {
        return reply.code(404).send({ error: 'Position not found' });
      }

      const { position, trade } = await recorder.recordSell({
        positionId: body.positionId,
        userPublicKey: body.userPublicKey,
        txSignature: body.txSignature,
        quantity: body.quantity,
        levelIndex: body.levelIndex,
        maxSlippageBps: body.maxSlippageBps,
        reason: body.reason,
      });
      return { position, trade };
    } catch (err) {
      if (err instanceof TransactionNotConfirmedError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
