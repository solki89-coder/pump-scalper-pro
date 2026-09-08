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
 * Returns null when TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID aren't set — the
 * spec's "leave empty to disable Telegram integration entirely". Every
 * command is gated to the configured chat id: the bot token alone must
 * never be sufficient to control trading — anyone who discovers the token
 * (or messages the bot before you configure a chat id) must not be able
 * to issue commands.
 */
export function createTelegramBot(): Bot | null {
  const config = loadConfig();
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) return null;

  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    if (String(ctx.chat?.id) !== config.TELEGRAM_CHAT_ID) return;
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
