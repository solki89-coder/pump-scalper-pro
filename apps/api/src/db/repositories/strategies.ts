import type { StrategyConfig } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface StrategyRow {
  id: string;
  user_id: string;
  name: string;
  enabled: boolean;
  autonomous: boolean;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

function mapStrategy(row: StrategyRow): StrategyConfig {
  return {
    ...(row.config as object),
    id: row.id,
    userId: row.user_id,
    name: row.name,
    enabled: row.enabled,
    autonomous: row.autonomous,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  } as StrategyConfig;
}

export async function createStrategy(config: StrategyConfig): Promise<StrategyConfig> {
  const row = await queryOne<StrategyRow>(
    `INSERT INTO strategies (user_id, name, enabled, autonomous, config)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [config.userId, config.name, config.enabled, config.autonomous, JSON.stringify(config)],
  );
  if (!row) throw new Error('createStrategy: no row returned');
  return mapStrategy(row);
}

export async function updateStrategy(id: string, config: StrategyConfig): Promise<StrategyConfig | null> {
  const row = await queryOne<StrategyRow>(
    `UPDATE strategies SET name = $2, enabled = $3, autonomous = $4, config = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, config.name, config.enabled, config.autonomous, JSON.stringify(config)],
  );
  return row ? mapStrategy(row) : null;
}

export async function getStrategy(id: string): Promise<StrategyConfig | null> {
  const row = await queryOne<StrategyRow>(`SELECT * FROM strategies WHERE id = $1`, [id]);
  return row ? mapStrategy(row) : null;
}

export async function listStrategies(userId: string): Promise<StrategyConfig[]> {
  const rows = await query<StrategyRow>(`SELECT * FROM strategies WHERE user_id = $1 ORDER BY created_at DESC`, [
    userId,
  ]);
  return rows.map(mapStrategy);
}

export async function listEnabledStrategies(userId: string): Promise<StrategyConfig[]> {
  const rows = await query<StrategyRow>(
    `SELECT * FROM strategies WHERE user_id = $1 AND enabled = true ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapStrategy);
}

export async function deleteStrategy(id: string): Promise<void> {
  await query(`DELETE FROM strategies WHERE id = $1`, [id]);
}
