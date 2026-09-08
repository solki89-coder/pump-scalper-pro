import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOrCreateBotState } from '../db/repositories/botState.js';
import { getPosition, listOpenPositions, listPositions } from '../db/repositories/positions.js';
import { getRiskConfig } from '../db/repositories/riskConfig.js';
import { getToken } from '../db/repositories/tokens.js';
import { evaluateTrade } from '../risk/index.js';
import { paperTradingService } from '../services.js';
import { getTelegramAlerts } from '../telegram/index.js';
import { getVirtualSolBalance } from '../trading/paperBalance.js';

const TakeProfitLevelInput = z.object({ triggerPercent: z.number().positive(), sellPercent: z.number().positive().max(100) });

const ManualBuySchema = z.object({
  mint: z.string().min(1),
  strategyId: z.string().uuid().nullable().default(null),
  sizeSol: z.number().positive(),
  stopLossPercent: z.number().positive(),
  stopLossMode: z.enum(['FIXED', 'DYNAMIC']).default('FIXED'),
  takeProfitLevels: z.array(TakeProfitLevelInput).default([]),
  trailingStopPercent: z.number().positive().nullable().default(null),
  maxSlippageBps: z.number().int().nonnegative(),
});

export default async function positionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/positions', { preHandler: fastify.authenticate }, async (request) => {
    const query = z.object({ status: z.enum(['open', 'all']).default('open') }).parse(request.query);
    return query.status === 'open' ? listOpenPositions(request.userId) : listPositions(request.userId);
  });

  // Manual BUY — per spec, must pass the Risk Engine exactly like any other trade.
  fastify.post('/api/positions', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = ManualBuySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }
    const body = parsed.data;

    const botState = await getOrCreateBotState(request.userId);
    if (botState.mode === 'LIVE') {
      return reply.code(501).send({ error: 'Live trading is not implemented yet (Phase 13).' });
    }

    const token = await getToken(body.mint);
    if (!token) {
      return reply.code(404).send({ error: `Unknown mint ${body.mint} — the scanner hasn't seen it yet.` });
    }

    const riskConfig = await getRiskConfig(request.userId);
    if (!riskConfig) {
      return reply.code(409).send({ error: 'No risk configuration set for this user yet.' });
    }

    const balance = await getVirtualSolBalance(request.userId, riskConfig.tradingAllocationSol);
    const riskResult = await evaluateTrade(
      {
        userId: request.userId,
        mint: body.mint,
        strategyId: body.strategyId,
        mode: 'PAPER',
        isAutonomous: false,
        sizeSol: body.sizeSol,
        slippageBps: body.maxSlippageBps,
        currentSolBalance: balance,
      },
      riskConfig,
    );
    if (!riskResult.approved) {
      return reply.code(403).send({ error: 'Rejected by Risk Engine', reasons: riskResult.reasons });
    }

    const { position, trade } = await paperTradingService.openPosition({
      userId: request.userId,
      strategyId: body.strategyId,
      mint: body.mint,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      sizeSol: body.sizeSol,
      currentPriceSol: token.priceSol,
      liquiditySol: token.liquiditySol ?? 0,
      maxSlippageBps: body.maxSlippageBps,
      stopLossPercent: body.stopLossPercent,
      stopLossMode: body.stopLossMode,
      takeProfitLevels: body.takeProfitLevels,
      trailingStopPercent: body.trailingStopPercent,
      entryOpportunityScore: null,
      entryRiskScore: null,
    });
    void getTelegramAlerts().buyExecuted(position);
    return reply.code(201).send({ position, trade });
  });

  const CloseSchema = z.object({ maxSlippageBps: z.number().int().nonnegative() });
  fastify.post('/api/positions/:id/close', { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = CloseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const position = await getPosition(params.id);
    if (!position || position.userId !== request.userId) {
      return reply.code(404).send({ error: 'Position not found' });
    }
    const token = await getToken(position.mint);
    if (!token) return reply.code(404).send({ error: 'Underlying token not found' });

    const { position: closed, trade } = await paperTradingService.closePosition({
      positionId: params.id,
      currentPriceSol: token.priceSol,
      liquiditySol: token.liquiditySol ?? 0,
      maxSlippageBps: parsed.data.maxSlippageBps,
      reason: 'MANUAL',
    });
    void getTelegramAlerts().sellExecuted(closed, trade);
    return { position: closed, trade };
  });
}
