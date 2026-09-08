import { getPool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

const APP_TABLES = [
  'trades',
  'positions',
  'signals',
  'risk_events',
  'system_events',
  'tokens',
  'strategies',
  'bot_state',
  'risk_configs',
  'wallets',
  'users',
];

export async function ensureTestSchema(): Promise<void> {
  await runMigrations(getPool());
}

export async function truncateAll(): Promise<void> {
  await getPool().query(`TRUNCATE TABLE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
