import { loadConfig } from '../config.js';
import { NoopTelegramAlerts, TelegramAlerts, type TelegramAlertsPort } from './alerts.js';
import { createTelegramBot } from './bot.js';

export { createTelegramBot, resolveOperatorUserId } from './bot.js';
export * as telegramCommands from './commands.js';
export * from './alerts.js';
export * as telegramFormatting from './formatting.js';

let alertsSingleton: TelegramAlertsPort | undefined;

/** The shared alerts sender every trading code path uses — a real Bot-backed sender when configured, a no-op otherwise. */
export function getTelegramAlerts(): TelegramAlertsPort {
  if (alertsSingleton) return alertsSingleton;
  const config = loadConfig();
  const bot = createTelegramBot();
  if (!bot || !config.TELEGRAM_CHAT_ID) {
    alertsSingleton = new NoopTelegramAlerts();
  } else {
    alertsSingleton = new TelegramAlerts(bot.api, config.TELEGRAM_CHAT_ID);
  }
  return alertsSingleton;
}
