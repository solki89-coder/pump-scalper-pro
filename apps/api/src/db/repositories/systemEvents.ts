import type { SystemEvent } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface SystemEventRow {
  id: string;
  user_id: string | null;
  type: SystemEvent['type'];
  details: Record<string, unknown>;
  created_at: Date;
}

function mapSystemEvent(row: SystemEventRow): SystemEvent {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    details: row.details,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createSystemEvent(event: Omit<SystemEvent, 'id' | 'createdAt'>): Promise<SystemEvent> {
  const row = await queryOne<SystemEventRow>(
    `INSERT INTO system_events (user_id, type, details) VALUES ($1, $2, $3) RETURNING *`,
    [event.userId, event.type, JSON.stringify(event.details)],
  );
  if (!row) throw new Error('createSystemEvent: no row returned');
  return mapSystemEvent(row);
}

export async function listSystemEvents(userId: string, limit = 200): Promise<SystemEvent[]> {
  const rows = await query<SystemEventRow>(
    `SELECT * FROM system_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapSystemEvent);
}
