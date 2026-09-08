import { loadConfig } from '../config.js';
import { countUsers, createUser } from '../db/repositories/users.js';
import { getOrCreateBotState } from '../db/repositories/botState.js';
import { upsertRiskConfig } from '../db/repositories/riskConfig.js';
import { upsertTelegramConfig } from '../db/repositories/telegramConfig.js';
import { hashPassword } from './passwords.js';

/**
 * This is a single-operator system (spec's users table exists for
 * auditability/multi-device login, not multi-tenant use). On first boot,
 * if no user exists yet and ADMIN_EMAIL/ADMIN_PASSWORD are set, seed one
 * account and its default (all-zero — nothing trades until configured)
 * risk config and bot state. If they're unset, boot proceeds with zero
 * users and login simply isn't possible yet — documented in README, not a
 * silent trap.
 */
export interface MinimalLogger {
  warn(msg: string): void;
  info(msg: string): void;
}

export async function ensureAdminUser(logger: MinimalLogger): Promise<void> {
  const config = loadConfig();
  const existing = await countUsers();
  if (existing > 0) return;

  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    logger.warn('No users exist yet and ADMIN_EMAIL/ADMIN_PASSWORD are not set — no one can log in until you set them and restart, or insert a user directly.');
    return;
  }

  const passwordHash = await hashPassword(config.ADMIN_PASSWORD);
  const user = await createUser(config.ADMIN_EMAIL, passwordHash);
  await getOrCreateBotState(user.id);
  await upsertRiskConfig({
    userId: user.id,
    maxPositionSizeSol: config.MAX_POSITION_SIZE_SOL,
    maxDailyLossSol: config.MAX_DAILY_LOSS_SOL,
    maxTotalExposureSol: config.MAX_TOTAL_EXPOSURE_SOL,
    maxOpenPositions: config.MAX_OPEN_POSITIONS,
    maxTradesPerDay: config.MAX_TRADES_PER_DAY,
    maxSlippageBps: config.MAX_SLIPPAGE_BPS,
    minSolBalance: config.MIN_SOL_BALANCE,
    autonomousEnabled: false,
    autonomousMaxPositionSol: null,
    autonomousMaxDailyLossSol: null,
    autonomousMaxTrades: null,
    tradingAllocationSol: config.TRADING_ALLOCATION_SOL,
  });

  // Telegram settings became dashboard-editable (Settings page,
  // routes/settings.ts) rather than env-var-only — seed the DB row from
  // TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID here (once, on first boot) purely
  // so an existing docker-compose .env keeps working out of the box
  // without a trip through the UI. From here on the DB row is the source
  // of truth; changing the env vars after this does nothing.
  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    await upsertTelegramConfig(user.id, { botToken: config.TELEGRAM_BOT_TOKEN, chatId: config.TELEGRAM_CHAT_ID, enabled: true });
  }

  logger.info(`Seeded admin user ${user.email} from ADMIN_EMAIL/ADMIN_PASSWORD.`);
}
