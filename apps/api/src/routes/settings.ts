import { TelegramSettingsUpdateSchema } from '@pump-scalper/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getTelegramConfig, upsertTelegramConfig } from '../db/repositories/telegramConfig.js';
import { createSystemEvent } from '../db/repositories/systemEvents.js';
import { telegramBotManager } from '../telegram/manager.js';
import { testTelegramConnection } from '../telegram/telegramApiClient.js';

const TestConnectionSchema = z.object({
  // Testing a token that hasn't been saved yet (before the operator hits
  // Save) needs the raw value from the form; testing an already-saved
  // config just needs the chat id, since the stored token is never sent
  // back to the browser to resubmit.
  botToken: z.string().min(1).optional(),
  chatId: z.string().min(1),
});

export default async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/settings/telegram', { preHandler: fastify.authenticate }, async (request) => {
    const stored = await getTelegramConfig(request.userId);
    const status = telegramBotManager.getStatus();
    return {
      chatId: stored?.chatId ?? null,
      enabled: stored?.enabled ?? false,
      hasToken: Boolean(stored?.botToken),
      running: status.running,
    };
  });

  fastify.put('/api/settings/telegram', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = TelegramSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    const body = parsed.data;

    const existing = await getTelegramConfig(request.userId);
    const effectiveToken = body.botToken ?? existing?.botToken ?? null;
    if (body.enabled && !effectiveToken) {
      return reply.code(400).send({ error: 'A bot token is required to enable Telegram — this account has none stored yet.' });
    }

    const saved = await upsertTelegramConfig(request.userId, { botToken: body.botToken, chatId: body.chatId, enabled: body.enabled });
    await createSystemEvent({ userId: request.userId, type: 'TELEGRAM_SETTINGS_UPDATED', details: { enabled: body.enabled } });

    // Takes effect immediately — no server restart required. See
    // TelegramBotManager.configure: stops whatever bot was running (if
    // any) before starting the new configuration in its place.
    if (saved.enabled && effectiveToken && saved.chatId) {
      await telegramBotManager.configure({ botToken: effectiveToken, chatId: saved.chatId });
    } else {
      await telegramBotManager.stop();
    }

    const status = telegramBotManager.getStatus();
    return { chatId: saved.chatId, enabled: saved.enabled, hasToken: Boolean(effectiveToken), running: status.running };
  });

  fastify.post('/api/settings/telegram/test', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = TestConnectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    const body = parsed.data;

    const token = body.botToken ?? (await getTelegramConfig(request.userId))?.botToken ?? null;
    if (!token) return reply.code(400).send({ error: 'No bot token to test — enter one first.' });

    const result = await testTelegramConnection(token, body.chatId);
    return result;
  });
}
