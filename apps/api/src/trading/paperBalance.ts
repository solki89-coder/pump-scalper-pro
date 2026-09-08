import { sumOpenEntryValueSol } from '../db/repositories/positions.js';
import { sumRealizedPnlSince } from '../db/repositories/trades.js';

/**
 * Paper trading has no real wallet to read a balance from, but the Risk
 * Engine's MIN_SOL_BALANCE/exposure checks need *some* balance figure to
 * be meaningful in paper mode too — otherwise paper trading would never
 * exercise those checks at all. Virtual balance = the strategy's trading
 * allocation, minus SOL actually committed (entry cost) to still-open
 * positions, plus realized PnL from closed trades.
 */
export async function getVirtualSolBalance(userId: string, tradingAllocationSol: number): Promise<number> {
  const [committed, realizedPnl] = await Promise.all([
    sumOpenEntryValueSol(userId),
    sumRealizedPnlSince(userId, null),
  ]);
  return tradingAllocationSol - committed + realizedPnl;
}
