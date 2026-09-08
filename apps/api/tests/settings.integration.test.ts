import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../src/auth/passwords.js';
import { closePool } from '../src/db/client.js';
import { createUser } from '../src/db/repositories/users.js';
import { buildServer } from '../src/server.js';
import { telegramBotManager, type TelegramBotLike } from '../src/telegram/manager.js';
import { ensureTestSchema, truncateAll } from './dbTestUtils.js';

let app: FastifyInstance;

beforeAll(async () => {
  await ensureTestSchema();
  app = await buildServer();
  await app.ready();
});

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await telegramBotManager.stop();
  telegramBotManager._setBotFactoryForTests(null);
});

afterAll(async () => {
  await app.close();
  await closePool();
});

async function loginToken(email = 'settings@example.com', password = 'password123') {
  await createUser(email, await hashPassword(password));
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  return (res.json() as { token: string }).token;
}

function fakeBot(): TelegramBotLike {
  return {
    api: { sendMessage: vi.fn().mockResolvedValue({}) },
    async start() {},
    async stop() {},
  };
}

describe('GET /api/settings/telegram', () => {
  it('defaults to disabled/no token/not running for a brand-new account', async () => {
    const token = await loginToken();
    const res = await app.inject({ method: 'GET', url: '/api/settings/telegram', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chatId: null, enabled: false, hasToken: false, running: false });
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/telegram' });
    expect(res.statusCode).toBe(401);
  });
});

describe('PUT /api/settings/telegram', () => {
  it('refuses to enable Telegram with no bot token ever stored', async () => {
    const token = await loginToken();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/telegram',
      headers: { authorization: `Bearer ${token}` },
      payload: { chatId: 'chat1', enabled: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('saving with a token and enabled:true starts the bot immediately, without a restart', async () => {
    telegramBotManager._setBotFactoryForTests(() => fakeBot());
    const token = await loginToken();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/telegram',
      headers: { authorization: `Bearer ${token}` },
      payload: { botToken: 'real-token', chatId: 'chat1', enabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chatId: 'chat1', enabled: true, hasToken: true, running: true });
    expect(telegramBotManager.getStatus()).toEqual({ running: true, chatId: 'chat1' });
  });

  it('changing chatId/enabled without resubmitting the token keeps using the stored one', async () => {
    telegramBotManager._setBotFactoryForTests(() => fakeBot());
    const token = await loginToken();
    const headers = { authorization: `Bearer ${token}` };

    await app.inject({ method: 'PUT', url: '/api/settings/telegram', headers, payload: { botToken: 'real-token', chatId: 'chat1', enabled: true } });

    const res = await app.inject({ method: 'PUT', url: '/api/settings/telegram', headers, payload: { chatId: 'chat2', enabled: true } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chatId: 'chat2', enabled: true, hasToken: true, running: true });
  });

  it('setting enabled:false stops the running bot', async () => {
    telegramBotManager._setBotFactoryForTests(() => fakeBot());
    const token = await loginToken();
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: 'PUT', url: '/api/settings/telegram', headers, payload: { botToken: 'real-token', chatId: 'chat1', enabled: true } });

    const res = await app.inject({ method: 'PUT', url: '/api/settings/telegram', headers, payload: { chatId: 'chat1', enabled: false } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ chatId: 'chat1', enabled: false, hasToken: true, running: false });
    expect(telegramBotManager.getStatus().running).toBe(false);
  });
});

describe('POST /api/settings/telegram/test', () => {
  it('refuses when there is no token to test, stored or supplied', async () => {
    const token = await loginToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/telegram/test',
      headers: { authorization: `Bearer ${token}` },
      payload: { chatId: 'chat1' },
    });
    expect(res.statusCode).toBe(400);
  });
});
