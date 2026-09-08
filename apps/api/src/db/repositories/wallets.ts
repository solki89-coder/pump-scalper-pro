import { query, queryOne } from '../client.js';

export type WalletLabel = 'main' | 'trading';

export interface WalletRow {
  id: string;
  user_id: string;
  label: WalletLabel;
  public_key: string | null;
  connected: boolean;
  trading_allocation_sol: number;
  updated_at: Date;
}

export interface WalletRecord {
  id: string;
  userId: string;
  label: WalletLabel;
  publicKey: string | null;
  connected: boolean;
  tradingAllocationSol: number;
  updatedAt: string;
}

function mapWallet(row: WalletRow): WalletRecord {
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    publicKey: row.public_key,
    connected: row.connected,
    tradingAllocationSol: row.trading_allocation_sol,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function upsertWallet(
  userId: string,
  label: WalletLabel,
  fields: { publicKey?: string | null; connected?: boolean; tradingAllocationSol?: number },
): Promise<WalletRecord> {
  const row = await queryOne<WalletRow>(
    `INSERT INTO wallets (user_id, label, public_key, connected, trading_allocation_sol)
     VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, 0))
     ON CONFLICT (user_id, label) DO UPDATE SET
       public_key = COALESCE($3, wallets.public_key),
       connected = COALESCE($4, wallets.connected),
       trading_allocation_sol = COALESCE($5, wallets.trading_allocation_sol),
       updated_at = now()
     RETURNING *`,
    [userId, label, fields.publicKey ?? null, fields.connected ?? null, fields.tradingAllocationSol ?? null],
  );
  if (!row) throw new Error('upsertWallet: no row returned');
  return mapWallet(row);
}

export async function getWallet(userId: string, label: WalletLabel): Promise<WalletRecord | null> {
  const row = await queryOne<WalletRow>(`SELECT * FROM wallets WHERE user_id = $1 AND label = $2`, [userId, label]);
  return row ? mapWallet(row) : null;
}

export async function listWallets(userId: string): Promise<WalletRecord[]> {
  const rows = await query<WalletRow>(`SELECT * FROM wallets WHERE user_id = $1 ORDER BY label`, [userId]);
  return rows.map(mapWallet);
}
