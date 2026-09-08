import { computePnlAnalytics } from '@pump-scalper/core';
import type { FastifyInstance } from 'fastify';
import { getOrCreateBotState } from '../db/repositories/botState.js';
import { countOpenPositions } from '../db/repositories/positions.js';
import { getRiskConfig } from '../db/repositories/riskConfig.js';
import { countTradesToday, listTrades, sumRealizedPnlSince } from '../db/repositories/trades.js';
import { getVirtualSolBalance } from '../trading/paperBalance.js';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The Main Dashboard's summary card — exactly the fields the spec lists: Portfolio, SOL Balance, Daily PnL, Total PnL, Open Positions, Trades Today, Win Rate, Max Drawdown, Bot Status. */
export default async function portfolioRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/portfolio', { preHandler: fastify.authenticate }, async (request) => {
    const [botState, riskConfig, openPositions, tradesToday, dailyPnlSol, allTrades] = await Promise.all([
      getOrCreateBotState(request.userId),
      getRiskConfig(request.userId),
      countOpenPositions(request.userId),
      countTradesToday(request.userId),
      sumRealizedPnlSince(request.userId, startOfToday()),
      listTrades(request.userId, 'ALL', 10_000),
    ]);

    const analytics = computePnlAnalytics(allTrades);
    const solBalance = riskConfig ? await getVirtualSolBalance(request.userId, riskConfig.tradingAllocationSol) : 0;

    return {
      solBalance,
      dailyPnlSol,
      totalPnlSol: analytics.totalPnlSol,
      openPositions,
      tradesToday,
      winRate: analytics.winRate,
      maxDrawdownPercent: analytics.maxDrawdownPercent,
      botStatus: botState.status,
    };
  });
}
