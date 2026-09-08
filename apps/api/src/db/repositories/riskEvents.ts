import type { RiskEvent } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface RiskEventRow {
  id: string;
  user_id: string;
  mint: string | null;
  strategy_id: string | null;
  reasons: RiskEvent['reasons'];
  attempted_size_sol: number | null;
  details: Record<string, unknown>;
  created_at: Date;
}

function mapRiskEvent(row: RiskEventRow): RiskEvent {
  return {
    id: row.id,
    userId: row.user_id,
    mint: row.mint,
    strategyId: row.strategy_id,
    reasons: row.reasons,
    attemptedSizeSol: row.attempted_size_sol,
    details: row.details,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createRiskEvent(event: Omit<RiskEvent, 'id' | 'createdAt'>): Promise<RiskEvent> {
  const row = await queryOne<RiskEventRow>(
    `INSERT INTO risk_events (user_id, mint, strategy_id, reasons, attempted_size_sol, details)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      event.userId,
      event.mint,
      event.strategyId,
      event.reasons,
      event.attemptedSizeSol,
      JSON.stringify(event.details),
    ],
  );
  if (!row) throw new Error('createRiskEvent: no row returned');
  return mapRiskEvent(row);
}

export async function listRiskEvents(userId: string, limit = 200): Promise<RiskEvent[]> {
  const rows = await query<RiskEventRow>(
    `SELECT * FROM risk_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapRiskEvent);
}
