import { describe, expect, it, vi } from 'vitest';
import { NoopTelegramAlerts, TelegramAlerts } from '../src/telegram/alerts.js';
import { TelegramBotManager, type TelegramBotFactory, type TelegramBotLike } from '../src/telegram/manager.js';

function fakeBot(): TelegramBotLike & { started: boolean; stopped: boolean } {
  const bot = {
    started: false,
    stopped: false,
    api: { sendMessage: vi.fn().mockResolvedValue({}) },
    async start() {
      bot.started = true;
    },
    async stop() {
      bot.stopped = true;
    },
  };
  return bot;
}

function silentLogger() {
  return { info: () => {}, error: () => {} };
}

describe('TelegramBotManager', () => {
  it('starts as a no-op alerts sender with nothing running', () => {
    const manager = new TelegramBotManager(() => null, silentLogger());
    expect(manager.getAlerts()).toBeInstanceOf(NoopTelegramAlerts);
    expect(manager.getStatus()).toEqual({ running: false, chatId: null });
  });

  it('configure() starts the bot via the factory and switches alerts to a real sender', async () => {
    const bot = fakeBot();
    const factory: TelegramBotFactory = () => bot;
    const manager = new TelegramBotManager(factory, silentLogger());

    await manager.configure({ botToken: 'tok', chatId: 'chat1' });

    expect(bot.started).toBe(true);
    expect(manager.getStatus()).toEqual({ running: true, chatId: 'chat1' });
    expect(manager.getAlerts()).toBeInstanceOf(TelegramAlerts);
  });

  it('configure(null) stops the running bot and reverts to a no-op sender', async () => {
    const bot = fakeBot();
    const manager = new TelegramBotManager(() => bot, silentLogger());
    await manager.configure({ botToken: 'tok', chatId: 'chat1' });

    await manager.configure(null);

    expect(bot.stopped).toBe(true);
    expect(manager.getStatus()).toEqual({ running: false, chatId: null });
    expect(manager.getAlerts()).toBeInstanceOf(NoopTelegramAlerts);
  });

  it('reconfiguring while already running stops the old bot before starting the new one', async () => {
    const oldBot = fakeBot();
    const newBot = fakeBot();
    let calls = 0;
    const factory: TelegramBotFactory = () => (calls++ === 0 ? oldBot : newBot);
    const manager = new TelegramBotManager(factory, silentLogger());

    await manager.configure({ botToken: 'tok1', chatId: 'chat1' });
    await manager.configure({ botToken: 'tok2', chatId: 'chat2' });

    expect(oldBot.stopped).toBe(true);
    expect(newBot.started).toBe(true);
    expect(manager.getStatus()).toEqual({ running: true, chatId: 'chat2' });
  });

  it('falls back to a no-op sender when the factory refuses (e.g. an empty token/chat id)', async () => {
    const manager = new TelegramBotManager(() => null, silentLogger());
    await manager.configure({ botToken: '', chatId: '' });
    expect(manager.getAlerts()).toBeInstanceOf(NoopTelegramAlerts);
    expect(manager.getStatus().running).toBe(false);
  });

  it('a stop() failure is logged but does not prevent reconfiguring', async () => {
    const badBot = fakeBot();
    badBot.stop = vi.fn().mockRejectedValue(new Error('polling already dead'));
    const newBot = fakeBot();
    let calls = 0;
    const factory: TelegramBotFactory = () => (calls++ === 0 ? badBot : newBot);
    const manager = new TelegramBotManager(factory, silentLogger());

    await manager.configure({ botToken: 'tok1', chatId: 'chat1' });
    await manager.configure({ botToken: 'tok2', chatId: 'chat2' });

    expect(newBot.started).toBe(true);
    expect(manager.getStatus()).toEqual({ running: true, chatId: 'chat2' });
  });
});
