import { NoopTelegramAlerts, TelegramAlerts, type TelegramAlertsPort } from './alerts.js';
import { createTelegramBot } from './bot.js';

export interface TelegramRuntimeConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramBotStatus {
  running: boolean;
  chatId: string | null;
}

/** The subset of grammy's `Bot` this module actually uses — lets tests inject a fake bot via `botFactory` instead of hitting the real Telegram API (`bot.start()` calls `getMe()` internally). */
export interface TelegramBotLike {
  api: { sendMessage(chatId: string, text: string, opts?: { parse_mode?: 'Markdown' }): Promise<unknown> };
  start(opts?: { onStart?: (info: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
}

export type TelegramBotFactory = (botToken: string, chatId: string) => TelegramBotLike | null;

/**
 * Owns the single running Telegram bot instance and the shared
 * `TelegramAlertsPort` every trading code path sends through
 * (`getTelegramAlerts()` in index.ts). Before this manager existed, the
 * bot was created once at process boot from env vars and never changed
 * again; now settings are editable from the dashboard
 * (routes/settings.ts) and must take effect immediately, without a
 * server restart — `configure()` stops whatever was running and starts
 * the new configuration in its place.
 */
export class TelegramBotManager {
  private bot: TelegramBotLike | null = null;
  private config: TelegramRuntimeConfig | null = null;
  private alerts: TelegramAlertsPort = new NoopTelegramAlerts();

  private readonly defaultBotFactory: TelegramBotFactory;

  constructor(
    private botFactory: TelegramBotFactory = createTelegramBot as unknown as TelegramBotFactory,
    private readonly logger: { info(msg: string): void; error(msg: string, err?: unknown): void } = console,
  ) {
    this.defaultBotFactory = botFactory;
  }

  getAlerts(): TelegramAlertsPort {
    return this.alerts;
  }

  getStatus(): TelegramBotStatus {
    return { running: this.bot !== null, chatId: this.config?.chatId ?? null };
  }

  /** Pass `null` to disable — stops any running bot and reverts alerts to a no-op. */
  async configure(next: TelegramRuntimeConfig | null): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch (err) {
        this.logger.error('Failed to stop the previous Telegram bot instance cleanly', err);
      }
      this.bot = null;
    }

    if (!next) {
      this.alerts = new NoopTelegramAlerts();
      this.config = null;
      return;
    }

    const bot = this.botFactory(next.botToken, next.chatId);
    if (!bot) {
      this.alerts = new NoopTelegramAlerts();
      this.config = null;
      return;
    }

    this.bot = bot;
    this.config = next;
    this.alerts = new TelegramAlerts(bot.api, next.chatId);
    // Long-polling runs until `.stop()` — fire-and-forget like the
    // original main()'s `void telegramBot.start(...)`, not awaited,
    // since it doesn't resolve until the bot stops.
    void bot.start({ onStart: () => this.logger.info('Telegram bot ready') }).catch((err) => {
      this.logger.error('Telegram bot polling stopped unexpectedly', err);
    });
  }

  async stop(): Promise<void> {
    await this.configure(null);
  }

  /**
   * Test-only seam for the shared `telegramBotManager` singleton
   * (imported directly by routes/settings.ts, so an integration test
   * driving that route through a real `configure()` call needs a way to
   * avoid hitting the real Telegram API — the same problem
   * `_resetConfigCacheForTests` in config.ts solves for env config).
   * Pass `null` to restore the real `createTelegramBot`-backed factory.
   */
  _setBotFactoryForTests(factory: TelegramBotFactory | null): void {
    this.botFactory = factory ?? this.defaultBotFactory;
  }
}

export const telegramBotManager = new TelegramBotManager();
