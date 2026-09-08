import type { RiskConfig } from '@pump-scalper/shared';
import { queryOne } from '../client.js';

interface RiskConfigRow {
  user_id: string;
  max_position_size_sol: number;
  max_daily_loss_sol: number;
  max_total_exposure_sol: number;
  max_open_positions: number;
  max_trades_per_day: number;
  max_slippage_bps: number;
  min_sol_balance: number;
  autonomous_enabled: boolean;
  autonomous_max_position_sol: number | null;
  autonomous_max_daily_loss_sol: number | null;
  autonomous_max_trades: number | null;
  trading_allocation_sol: number;
}

function mapRiskConfig(row: RiskConfigRow): RiskConfig {
  return {
    userId: row.user_id,
    maxPositionSizeSol: row.max_position_size_sol,
    maxDailyLossSol: row.max_daily_loss_sol,
    maxTotalExposureSol: row.max_total_exposure_sol,
    maxOpenPositions: row.max_open_positions,
    maxTradesPerDay: row.max_trades_per_day,
    maxSlippageBps: row.max_slippage_bps,
    minSolBalance: row.min_sol_balance,
    autonomousEnabled: row.autonomous_enabled,
    autonomousMaxPositionSol: row.autonomous_max_position_sol,
    autonomousMaxDailyLossSol: row.autonomous_max_daily_loss_sol,
    autonomousMaxTrades: row.autonomous_max_trades,
    tradingAllocationSol: row.trading_allocation_sol,
  };
}

export async function getRiskConfig(userId: string): Promise<RiskConfig | null> {
  const row = await queryOne<RiskConfigRow>(`SELECT * FROM risk_configs WHERE user_id = $1`, [userId]);
  return row ? mapRiskConfig(row) : null;
}

export async function upsertRiskConfig(config: RiskConfig): Promise<RiskConfig> {
  const row = await queryOne<RiskConfigRow>(
    `INSERT INTO risk_configs (
       user_id, max_position_size_sol, max_daily_loss_sol, max_total_exposure_sol,
       max_open_positions, max_trades_per_day, max_slippage_bps, min_sol_balance,
       autonomous_enabled, autonomous_max_position_sol, autonomous_max_daily_loss_sol,
       autonomous_max_trades, trading_allocation_sol
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (user_id) DO UPDATE SET
       max_position_size_sol = $2, max_daily_loss_sol = $3, max_total_exposure_sol = $4,
       max_open_positions = $5, max_trades_per_day = $6, max_slippage_bps = $7, min_sol_balance = $8,
       autonomous_enabled = $9, autonomous_max_position_sol = $10, autonomous_max_daily_loss_sol = $11,
       autonomous_max_trades = $12, trading_allocation_sol = $13, updated_at = now()
     RETURNING *`,
    [
      config.userId,
      config.maxPositionSizeSol,
      config.maxDailyLossSol,
      config.maxTotalExposureSol,
      config.maxOpenPositions,
      config.maxTradesPerDay,
      config.maxSlippageBps,
      config.minSolBalance,
      config.autonomousEnabled,
      config.autonomousMaxPositionSol,
      config.autonomousMaxDailyLossSol,
      config.autonomousMaxTrades,
      config.tradingAllocationSol,
    ],
  );
  if (!row) throw new Error('upsertRiskConfig: no row returned');
  return mapRiskConfig(row);
}
