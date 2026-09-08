import { PaperExecutionEngine } from '@pump-scalper/core';
import { RpcHealthMonitor } from '@pump-scalper/solana';
import { runAutonomousCycle, type AutonomousCyclePorts } from './autonomous/autonomousEngine.js';
import { getOrCreateBotState } from './db/repositories/botState.js';
import { listOpenPositions, updatePosition } from './db/repositories/positions.js';
import { getRiskConfig } from './db/repositories/riskConfig.js';
import { listEnabledStrategies, getStrategy } from './db/repositories/strategies.js';
import { getToken, listRecentTokens } from './db/repositories/tokens.js';
import { listUsers } from './db/repositories/users.js';
import { evaluateTrade } from './risk/index.js';
import { createTokenScanner } from './scanner/index.js';
import { paperTradingService } from './services.js';
import { getConnection } from './solana.js';
import { getTelegramAlerts } from './telegram/index.js';
import { getVirtualSolBalance } from './trading/paperBalance.js';
import { monitorPositionTick } from './trading/positionMonitor.js';

export interface LoopLogger {
  info(obj: unknown, msg?: string): void;
  info(msg: string): void;
  error(obj: unknown, msg?: string): void;
  error(msg: string): void;
}

const POSITION_MONITOR_INTERVAL_MS = 10_000;
const AUTONOMOUS_CYCLE_INTERVAL_MS = 15_000;
const executionEngine = new PaperExecutionEngine();

// Exits run for every open position regardless of bot_state.status or the
// kill switch (see positionMonitor.ts's reasoning) — capital protection
// never pauses just because new entries have. So unlike the autonomous
// loop below, this one does not check botState at all.
async function monitorAllOpenPositions(logger: LoopLogger): Promise<void> {
  const users = await listUsers();
  for (const user of users) {
    const [riskConfig, positions] = await Promise.all([getRiskConfig(user.id), listOpenPositions(user.id)]);
    if (positions.length === 0) continue;
    for (const position of positions) {
      try {
        const token = await getToken(position.mint);
        if (!token) continue;
        const strategy = position.strategyId ? await getStrategy(position.strategyId) : null;
        await monitorPositionTick(
          position,
          token.priceSol,
          token.liquiditySol ?? 0,
          strategy?.maxSlippageBps ?? riskConfig?.maxSlippageBps ?? 1000,
          strategy?.maxHoldingTimeSeconds ?? null,
          { updatePosition },
          paperTradingService,
          { info: (m) => logger.info(m), error: (m, err) => logger.error({ err }, m) },
          getTelegramAlerts(),
        );
      } catch (err) {
        logger.error({ err, positionId: position.id }, 'position monitor tick failed');
      }
    }
  }
}

async function runAutonomousCycleForAllUsers(logger: LoopLogger): Promise<void> {
  const users = await listUsers();
  const recentTokens = await listRecentTokens(200);

  for (const user of users) {
    const botState = await getOrCreateBotState(user.id);
    // Autonomous trading only runs once the user has explicitly pressed
    // Start (status RUNNING) — unlike position monitoring above, this loop
    // is about opening new exposure, so it stays off by default like
    // everything else that isn't an exit.
    if (botState.status !== 'RUNNING') continue;
    const strategies = await listEnabledStrategies(user.id);
    const autonomousStrategies = strategies.filter((s) => s.autonomous);
    if (autonomousStrategies.length === 0) continue;

    const openPositions = await listOpenPositions(user.id);
    const openMints = new Set(openPositions.map((p) => p.mint));
    const candidateTokens = recentTokens.filter((t) => !openMints.has(t.mint));

    const ports: AutonomousCyclePorts = {
      getRiskConfig: (userId) => getRiskConfig(userId),
      getSolBalance: async () => {
        const riskConfig = await getRiskConfig(user.id);
        return riskConfig ? getVirtualSolBalance(user.id, riskConfig.tradingAllocationSol) : 0;
      },
      evaluateTrade: (request, riskConfig) => evaluateTrade(request, riskConfig),
      estimateSlippageBps: (sizeSol, liquiditySol) => executionEngine.estimateSlippage(sizeSol, liquiditySol),
      openPaperPosition: (strategy, snapshot, scores) =>
        paperTradingService.openPosition({
          userId: user.id,
          strategyId: strategy.id ?? null,
          mint: snapshot.mint,
          tokenName: snapshot.name,
          tokenSymbol: snapshot.symbol,
          sizeSol: strategy.positionSizeSol,
          currentPriceSol: snapshot.priceSol,
          liquiditySol: snapshot.liquiditySol ?? 0,
          maxSlippageBps: strategy.maxSlippageBps,
          stopLossPercent: strategy.stopLossPercent,
          stopLossMode: strategy.stopLossMode,
          takeProfitLevels: strategy.takeProfitLevels,
          trailingStopPercent: strategy.trailingStopPercent,
          entryOpportunityScore: scores.opportunityScore,
          entryRiskScore: scores.riskScore,
        }),
      alerts: getTelegramAlerts(),
    };

    try {
      const result = await runAutonomousCycle(
        {
          userId: user.id,
          strategies: autonomousStrategies,
          candidateTokens,
          killSwitchActive: botState.killSwitchActive,
          botMode: botState.mode,
        },
        ports,
      );
      if (result.opened.length > 0) {
        logger.info({ userId: user.id, opened: result.opened }, 'autonomous cycle opened positions');
      }
    } catch (err) {
      logger.error({ err, userId: user.id }, 'autonomous cycle failed');
    }
  }
}

export interface RuntimeLoop {
  stop(): Promise<void>;
}

/**
 * Boots the always-on parts of the system: the token scanner, an RPC
 * health monitor (RPC_ERROR alert on trouble), and two polling loops
 * (position monitoring, autonomous trading) that iterate every user in
 * the database — a real multi-tenant loop, even though today's deployment
 * is documented as single-operator. Nothing in this file bypasses the
 * Risk Engine, the kill switch, or PAPER-only enforcement; it only calls
 * functions that already enforce those themselves.
 */
export function startRuntimeLoop(logger: LoopLogger): RuntimeLoop {
  const scanner = createTokenScanner();
  scanner.start();

  const health = new RpcHealthMonitor({ getSlot: () => getConnection().getSlot() }, 30_000);
  health.on('unhealthy', ({ error, consecutiveFailures }: { error: Error; consecutiveFailures: number }) => {
    logger.error({ err: error, consecutiveFailures }, 'RPC health check failed');
    if (consecutiveFailures === 3) void getTelegramAlerts().rpcError(error.message, consecutiveFailures);
  });
  health.on('reconnected', ({ downForMs }: { downForMs: number }) => {
    logger.info({ downForMs }, 'RPC reconnected');
  });
  health.start();

  const positionTimer = setInterval(() => void monitorAllOpenPositions(logger), POSITION_MONITOR_INTERVAL_MS);
  const autonomousTimer = setInterval(() => void runAutonomousCycleForAllUsers(logger), AUTONOMOUS_CYCLE_INTERVAL_MS);

  return {
    async stop() {
      clearInterval(positionTimer);
      clearInterval(autonomousTimer);
      health.stop();
      await scanner.stop();
    },
  };
}
