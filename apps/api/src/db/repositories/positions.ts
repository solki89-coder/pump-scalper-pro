import type { Position, TakeProfitLevelState } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface PositionRow {
  id: string;
  user_id: string;
  strategy_id: string | null;
  mode: Position['mode'];
  status: Position['status'];
  mint: string;
  token_name: string;
  token_symbol: string;
  entry_price: number;
  current_price: number;
  highest_price: number;
  quantity: number;
  original_quantity: number;
  entry_value_sol: number;
  current_value_sol: number;
  unrealized_pnl_sol: number;
  unrealized_pnl_percent: number;
  realized_pnl_sol: number;
  stop_loss_percent: number;
  stop_loss_price: number;
  stop_loss_mode: Position['stopLossMode'];
  take_profit_levels: TakeProfitLevelState[];
  trailing_stop_percent: number | null;
  trailing_stop_price: number | null;
  entry_opportunity_score: number | null;
  entry_risk_score: number | null;
  entry_time: Date;
  closed_at: Date | null;
}

function mapPosition(row: PositionRow): Position {
  const closedAt = row.closed_at;
  const holdingTimeSeconds = Math.max(
    0,
    ((closedAt ?? new Date()).getTime() - row.entry_time.getTime()) / 1000,
  );
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    mode: row.mode,
    status: row.status,
    mint: row.mint,
    tokenName: row.token_name,
    tokenSymbol: row.token_symbol,
    entryPrice: row.entry_price,
    currentPrice: row.current_price,
    highestPrice: row.highest_price,
    quantity: row.quantity,
    originalQuantity: row.original_quantity,
    entryValueSol: row.entry_value_sol,
    currentValueSol: row.current_value_sol,
    unrealizedPnlSol: row.unrealized_pnl_sol,
    unrealizedPnlPercent: row.unrealized_pnl_percent,
    realizedPnlSol: row.realized_pnl_sol,
    stopLossPercent: row.stop_loss_percent,
    stopLossPrice: row.stop_loss_price,
    stopLossMode: row.stop_loss_mode,
    takeProfitLevels: row.take_profit_levels,
    trailingStopPercent: row.trailing_stop_percent,
    trailingStopPrice: row.trailing_stop_price,
    entryOpportunityScore: row.entry_opportunity_score,
    entryRiskScore: row.entry_risk_score,
    entryTime: row.entry_time.toISOString(),
    closedAt: closedAt ? closedAt.toISOString() : null,
    holdingTimeSeconds: Math.round(holdingTimeSeconds),
  };
}

export async function createPosition(p: Omit<Position, 'id' | 'holdingTimeSeconds'>): Promise<Position> {
  const row = await queryOne<PositionRow>(
    `INSERT INTO positions (
       user_id, strategy_id, mode, status, mint, token_name, token_symbol,
       entry_price, current_price, highest_price, quantity, original_quantity, entry_value_sol, current_value_sol,
       unrealized_pnl_sol, unrealized_pnl_percent, realized_pnl_sol,
       stop_loss_percent, stop_loss_price, stop_loss_mode, take_profit_levels, trailing_stop_percent, trailing_stop_price,
       entry_opportunity_score, entry_risk_score, entry_time, closed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING *`,
    [
      p.userId, p.strategyId, p.mode, p.status, p.mint, p.tokenName, p.tokenSymbol,
      p.entryPrice, p.currentPrice, p.highestPrice, p.quantity, p.originalQuantity, p.entryValueSol, p.currentValueSol,
      p.unrealizedPnlSol, p.unrealizedPnlPercent, p.realizedPnlSol,
      p.stopLossPercent, p.stopLossPrice, p.stopLossMode, JSON.stringify(p.takeProfitLevels), p.trailingStopPercent, p.trailingStopPrice,
      p.entryOpportunityScore, p.entryRiskScore, p.entryTime, p.closedAt,
    ],
  );
  if (!row) throw new Error('createPosition: no row returned');
  return mapPosition(row);
}

export async function updatePosition(
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
): Promise<Position | null> {
  const existing = await getPosition(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  const row = await queryOne<PositionRow>(
    `UPDATE positions SET
       quantity = $2, current_price = $3, highest_price = $4, current_value_sol = $5,
       unrealized_pnl_sol = $6, unrealized_pnl_percent = $7, realized_pnl_sol = $8,
       stop_loss_price = $9, take_profit_levels = $10, trailing_stop_price = $11,
       status = $12, closed_at = $13, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      merged.quantity,
      merged.currentPrice,
      merged.highestPrice,
      merged.currentValueSol,
      merged.unrealizedPnlSol,
      merged.unrealizedPnlPercent,
      merged.realizedPnlSol,
      merged.stopLossPrice,
      JSON.stringify(merged.takeProfitLevels),
      merged.trailingStopPrice,
      merged.status,
      merged.closedAt,
    ],
  );
  return row ? mapPosition(row) : null;
}

export async function getPosition(id: string): Promise<Position | null> {
  const row = await queryOne<PositionRow>(`SELECT * FROM positions WHERE id = $1`, [id]);
  return row ? mapPosition(row) : null;
}

export async function listOpenPositions(userId: string): Promise<Position[]> {
  const rows = await query<PositionRow>(
    `SELECT * FROM positions WHERE user_id = $1 AND status = 'OPEN' ORDER BY entry_time DESC`,
    [userId],
  );
  return rows.map(mapPosition);
}

export async function listPositions(userId: string, limit = 200): Promise<Position[]> {
  const rows = await query<PositionRow>(
    `SELECT * FROM positions WHERE user_id = $1 ORDER BY entry_time DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapPosition);
}

export async function countOpenPositions(userId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM positions WHERE user_id = $1 AND status = 'OPEN'`,
    [userId],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function sumOpenExposureSol(userId: string): Promise<number> {
  const rows = await query<{ total: string | null }>(
    `SELECT sum(current_value_sol)::text AS total FROM positions WHERE user_id = $1 AND status = 'OPEN'`,
    [userId],
  );
  return Number(rows[0]?.total ?? '0');
}
