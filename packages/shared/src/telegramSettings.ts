import { z } from 'zod';

/**
 * GET /api/settings/telegram's response shape — deliberately never
 * includes the bot token itself, only whether one is stored (`hasToken`)
 * and whether the manager currently has a bot instance polling
 * (`running`, which can be false even with `enabled: true` if the token
 * turned out to be invalid at the last reconfigure).
 */
export const TelegramSettingsSchema = z.object({
  chatId: z.string().nullable(),
  enabled: z.boolean(),
  hasToken: z.boolean(),
  running: z.boolean(),
});
export type TelegramSettings = z.infer<typeof TelegramSettingsSchema>;

/**
 * PUT /api/settings/telegram's request body. `botToken` is optional and
 * omitted (or blank) means "keep whatever token is already stored" — the
 * server never sends the real token back to the client, so there's
 * nothing for the client to resubmit unless the operator is actually
 * changing it.
 */
export const TelegramSettingsUpdateSchema = z.object({
  botToken: z.string().min(1).optional(),
  chatId: z.string().min(1),
  enabled: z.boolean(),
});
export type TelegramSettingsUpdate = z.infer<typeof TelegramSettingsUpdateSchema>;

export const TelegramTestConnectionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), botUsername: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TelegramTestConnectionResult = z.infer<typeof TelegramTestConnectionResultSchema>;
