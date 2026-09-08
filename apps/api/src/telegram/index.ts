import type { TelegramAlertsPort } from './alerts.js';
import { telegramBotManager } from './manager.js';

export { createTelegramBot, resolveOperatorUserId } from './bot.js';
export * as telegramCommands from './commands.js';
export * from './alerts.js';
export * as telegramFormatting from './formatting.js';
export { telegramBotManager, TelegramBotManager, type TelegramRuntimeConfig, type TelegramBotStatus } from './manager.js';
export { testTelegramConnection, type TelegramTestResult } from './telegramApiClient.js';

/**
 * The shared alerts sender every trading code path uses — delegates to
 * `telegramBotManager`, which owns the actual bot instance and is
 * reconfigured live when Telegram settings change in the dashboard
 * (routes/settings.ts), without a server restart.
 */
export function getTelegramAlerts(): TelegramAlertsPort {
  return telegramBotManager.getAlerts();
}
