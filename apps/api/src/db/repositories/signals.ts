import type { Signal } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface SignalRow {
  id: string;
  mint: string;
  strategy_id: string | null;
  signal: Signal['signal'];
  reason: string;
  scores: Signal['scores'];
  created_at: Date;
}

function mapSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    mint: row.mint,
    strategyId: row.strategy_id,
    signal: row.signal,
    reason: row.reason,
    scores: row.scores,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createSignal(signal: Omit<Signal, 'id' | 'createdAt'>): Promise<Signal> {
  const row = await queryOne<SignalRow>(
    `INSERT INTO signals (mint, strategy_id, signal, reason, scores)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [signal.mint, signal.strategyId, signal.signal, signal.reason, JSON.stringify(signal.scores)],
  );
  if (!row) throw new Error('createSignal: no row returned');
  return mapSignal(row);
}

export async function listSignalsForMint(mint: string, limit = 50): Promise<Signal[]> {
  const rows = await query<SignalRow>(
    `SELECT * FROM signals WHERE mint = $1 ORDER BY created_at DESC LIMIT $2`,
    [mint, limit],
  );
  return rows.map(mapSignal);
}

export async function listRecentSignals(limit = 100): Promise<Signal[]> {
  const rows = await query<SignalRow>(`SELECT * FROM signals ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows.map(mapSignal);
}
