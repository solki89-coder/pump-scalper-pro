import { Bot } from 'grammy';
import { loadConfig } from '../config.js';
import { getUserByEmail, listUsers } from '../db/repositories/users.js';
import { commands } from './commands.js';

export async function resolveOperatorUserId(): Promise<string | null> {
  const config = loadConfig();
  if (config.ADMIN_EMAIL) {
    const user = await getUserByEmail(config.ADMIN_EMAIL);
    if (user) return user.id;
  }
  const users = await listUsers();
  return users[0]?.id ?? null;
}

/**
 * Takes the token/chat id explicitly rather than reading env config
 * directly, so it works both for the original env-var-only setup and for
 * the dashboard-editable settings TelegramBotManager reconfigures at
 * runtime (routes/settings.ts) — this function itself doesn't care where
 * the values came from. Returns null when either is empty, matching the
 * original "leave empty to disable Telegram integration entirely".
 * Every command is gated to the configured chat id: the bot token alone
 * must never be sufficient to control trading — anyone who discovers the
 * token (or messages the bot before a chat id is configured) must not be
 * able to issue commands.
 */
export function createTelegramBot(botToken: string, chatId: string): Bot | null {
  if (!botToken || !chatId) return null;

  const bot = new Bot(botToken);

  bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) !== chatId) return;
    await next();
  });

  const bind = (fn: (userId: string | null, reply: (text: string) => Promise<void>) => Promise<void>) => async (ctx: import('grammy').Context) => {
    const userId = await resolveOperatorUserId();
    await fn(userId, async (text) => {
      await ctx.reply(text, { parse_mode: 'Markdown' });
    });
  };

  bot.command('status', bind(commands.status));
  bot.command('pnl', bind(commands.pnl));
  bot.command('positions', bind(commands.positions));
  bot.command('tokens', bind(commands.tokens));
  bot.command('start', bind(commands.start));
  bot.command('stop', bind(commands.stop));
  bot.command('paper', bind(commands.paper));
  bot.command('live', bind(commands.live));
  bot.command('risk', bind(commands.risk));
  bot.command('strategy', bind(commands.strategy));
  bot.command('kill', bind(commands.kill));

  return bot;
}
