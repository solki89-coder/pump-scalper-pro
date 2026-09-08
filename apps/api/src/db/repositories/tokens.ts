import type { TokenSnapshot } from '@pump-scalper/shared';
import { query, queryOne } from '../client.js';

interface TokenRow {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  first_seen_at: Date;
  price_sol: number;
  market_cap_sol: number | null;
  liquidity_sol: number | null;
  volume_sol_5m: number | null;
  buys_5m: number | null;
  sells_5m: number | null;
  unique_buyers_5m: number | null;
  unique_sellers_5m: number | null;
  holders: number | null;
  creator_holding_percent: number | null;
  top_holder_concentration_percent: number | null;
  bonding_curve_status: TokenSnapshot['bondingCurveStatus'];
  graduation_status: TokenSnapshot['graduationStatus'];
  updated_at: Date;
}

function mapToken(row: TokenRow): TokenSnapshot {
  const ageSeconds = Math.max(0, (Date.now() - row.first_seen_at.getTime()) / 1000);
  return {
    mint: row.mint,
    name: row.name,
    symbol: row.symbol,
    creator: row.creator,
    ageSeconds,
    priceSol: row.price_sol,
    marketCapSol: row.market_cap_sol,
    liquiditySol: row.liquidity_sol,
    volumeSol5m: row.volume_sol_5m,
    buys5m: row.buys_5m,
    sells5m: row.sells_5m,
    uniqueBuyers5m: row.unique_buyers_5m,
    uniqueSellers5m: row.unique_sellers_5m,
    holders: row.holders,
    creatorHoldingPercent: row.creator_holding_percent,
    topHolderConcentrationPercent: row.top_holder_concentration_percent,
    bondingCurveStatus: row.bonding_curve_status,
    graduationStatus: row.graduation_status,
    observedAt: row.updated_at.toISOString(),
  };
}

/** Insert on first sighting, otherwise refresh the mutable market fields. `first_seen_at` never changes. */
export async function upsertToken(snapshot: TokenSnapshot): Promise<TokenSnapshot> {
  const firstSeenAt = new Date(Date.now() - snapshot.ageSeconds * 1000);
  const row = await queryOne<TokenRow>(
    `INSERT INTO tokens (
       mint, name, symbol, creator, first_seen_at, price_sol, market_cap_sol, liquidity_sol,
       volume_sol_5m, buys_5m, sells_5m, unique_buyers_5m, unique_sellers_5m, holders,
       creator_holding_percent, top_holder_concentration_percent, bonding_curve_status, graduation_status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (mint) DO UPDATE SET
       price_sol = $6, market_cap_sol = $7, liquidity_sol = $8, volume_sol_5m = $9,
       buys_5m = $10, sells_5m = $11, unique_buyers_5m = $12, unique_sellers_5m = $13,
       holders = $14, creator_holding_percent = $15, top_holder_concentration_percent = $16,
       bonding_curve_status = $17, graduation_status = $18, updated_at = now()
     RETURNING *`,
    [
      snapshot.mint,
      snapshot.name,
      snapshot.symbol,
      snapshot.creator,
      firstSeenAt,
      snapshot.priceSol,
      snapshot.marketCapSol,
      snapshot.liquiditySol,
      snapshot.volumeSol5m,
      snapshot.buys5m,
      snapshot.sells5m,
      snapshot.uniqueBuyers5m,
      snapshot.uniqueSellers5m,
      snapshot.holders,
      snapshot.creatorHoldingPercent,
      snapshot.topHolderConcentrationPercent,
      snapshot.bondingCurveStatus,
      snapshot.graduationStatus,
    ],
  );
  if (!row) throw new Error('upsertToken: no row returned');
  return mapToken(row);
}

export async function getToken(mint: string): Promise<TokenSnapshot | null> {
  const row = await queryOne<TokenRow>(`SELECT * FROM tokens WHERE mint = $1`, [mint]);
  return row ? mapToken(row) : null;
}

export async function listRecentTokens(limit = 100): Promise<TokenSnapshot[]> {
  const rows = await query<TokenRow>(`SELECT * FROM tokens ORDER BY updated_at DESC LIMIT $1`, [limit]);
  return rows.map(mapToken);
}
