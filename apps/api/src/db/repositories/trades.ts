import type { Trade } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface TradeRow {
  id: string;
  user_id: string;
  position_id: string;
  strategy_id: string | null;
  mode: Trade['mode'];
  mint: string;
  token_name: string;
  token_symbol: string;
  side: Trade['side'];
  price: number;
  quantity: number;
  size_sol: number;
  fees_sol: number;
  slippage_bps: number;
  pnl_sol: number | null;
  pnl_percent: number | null;
  exit_reason: Trade['exitReason'];
  holding_time_seconds: number | null;
  entry_opportunity_score: number | null;
  entry_risk_score: number | null;
  tx_signature: string | null;
  executed_at: Date;
}

function mapTrade(row: TradeRow): Trade {
  return {
    id: row.id,
    userId: row.user_id,
    positionId: row.position_id,
    strategyId: row.strategy_id,
    mode: row.mode,
    mint: row.mint,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    side: row.side,
    price: row.price,
    quantity: row.quantity,
    sizeSol: row.size_sol,
    feesSol: row.fees_sol,
    slippageBps: row.slippage_bps,
    pnlSol: row.pnl_sol,
    pnlPercent: row.pnl_percent,
    exitReason: row.exit_reason,
    holdingTimeSeconds: row.holding_time_seconds,
    entryOpportunityScore: row.entry_opportunity_score,
    entryRiskScore: row.entry_risk_score,
    txSignature: row.tx_signature,
    executedAt: row.executed_at.toISOString(),
  };
}

export async function createTrade(t: Omit<Trade, 'id' | 'executedAt'>): Promise<Trade> {
  const row = await queryOne<TradeRow>(
    `INSERT INTO trades (
       user_id, position_id, strategy_id, mode, mint, token_name, token_symbol, side,
       price, quantity, size_sol, fees_sol, slippage_bps, pnl_sol, pnl_percent, exit_reason,
       holding_time_seconds, entry_opportunity_score, entry_risk_score, tx_signature
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      t.userId, t.positionId, t.strategyId, t.mode, t.mint, t.tokenName, t.tokenSymbol, t.side,
      t.price, t.quantity, t.sizeSol, t.feesSol, t.slippageBps, t.pnlSol, t.pnlPercent, t.exitReason,
      t.holdingTimeSeconds, t.entryOpportunityScore, t.entryRiskScore, t.txSignature,
    ],
  );
  if (!row) throw new Error('createTrade: no row returned');
  return mapTrade(row);
}

export type TradeHistoryFilter = 'TODAY' | 'SEVEN_DAYS' | 'THIRTY_DAYS' | 'ALL';

function sinceForFilter(filter: TradeHistoryFilter): Date | null {
  const now = Date.now();
  switch (filter) {
    case 'TODAY': {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'SEVEN_DAYS':
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case 'THIRTY_DAYS':
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case 'ALL':
      return null;
  }
}

export async function listTrades(userId: string, filter: TradeHistoryFilter = 'ALL', limit = 500): Promise<Trade[]> {
  const since = sinceForFilter(filter);
  const rows = since
    ? await query<TradeRow>(
        `SELECT * FROM trades WHERE user_id = $1 AND executed_at >= $2 ORDER BY executed_at DESC LIMIT $3`,
        [userId, since, limit],
      )
    : await query<TradeRow>(`SELECT * FROM trades WHERE user_id = $1 ORDER BY executed_at DESC LIMIT $2`, [
        userId,
        limit,
      ]);
  return rows.map(mapTrade);
}

export async function countTradesToday(userId: string): Promise<number> {
  const since = sinceForFilter('TODAY');
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM trades WHERE user_id = $1 AND side = 'BUY' AND executed_at >= $2`,
    [userId, since],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function sumRealizedPnlSince(userId: string, since: Date | null): Promise<number> {
  const rows = since
    ? await query<{ total: string | null }>(
        `SELECT sum(pnl_sol)::text AS total FROM trades WHERE user_id = $1 AND side = 'SELL' AND executed_at >= $2`,
        [userId, since],
      )
    : await query<{ total: string | null }>(
        `SELECT sum(pnl_sol)::text AS total FROM trades WHERE user_id = $1 AND side = 'SELL'`,
        [userId],
      );
  return Number(rows[0]?.total ?? '0');
}
