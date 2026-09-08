import { z } from 'zod';

/**
 * A minimal, directly-testable client against Telegram's Bot API — used
 * only by the Settings page's "Test Connection" action (routes/settings.ts),
 * kept separate from grammy's `Bot` class (used for the actual long-polling
 * command bot in bot.ts/manager.ts) so this one call can be unit-tested
 * with a fake fetch, the same pattern as JupiterSwapAdapter.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const GetMeResponseSchema = z.object({ ok: z.boolean(), result: z.object({ username: z.string() }).optional(), description: z.string().optional() });
const SendMessageResponseSchema = z.object({ ok: z.boolean(), description: z.string().optional() });

export type TelegramTestResult = { ok: true; botUsername: string } | { ok: false; error: string };

/**
 * Validates the bot token via `getMe`, then sends a real confirmation
 * message to `chatId` — this is deliberately two calls, not one: a valid
 * token with a wrong chat id is a different, more diagnosable failure
 * ("token is fine, but I couldn't reach that chat — did you copy the
 * right chat id?") than an invalid token outright.
 */
export async function testTelegramConnection(
  botToken: string,
  chatId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<TelegramTestResult> {
  // A network-level failure (DNS, timeout, a non-JSON error page from a
  // proxy in between) is exactly the kind of thing this button exists to
  // surface — catch broadly rather than letting it throw uncaught into
  // the route handler, where Phase 14's global error handler would turn
  // it into an unhelpful generic 500 instead of a diagnosable message.
  try {
    const meRes = await fetchImpl(`https://api.telegram.org/bot${botToken}/getMe`);
    const meBody = GetMeResponseSchema.parse(await meRes.json());
    if (!meRes.ok || !meBody.ok || !meBody.result) {
      return { ok: false, error: meBody.description ?? `Telegram rejected this bot token (HTTP ${meRes.status}).` };
    }

    const sendRes = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ PUMP SCALPER PRO is connected to this chat.' }),
    });
    const sendBody = SendMessageResponseSchema.parse(await sendRes.json());
    if (!sendRes.ok || !sendBody.ok) {
      return {
        ok: false,
        error: `Bot token is valid (@${meBody.result.username}), but sending a message to chat id "${chatId}" failed: ${sendBody.description ?? `HTTP ${sendRes.status}`}. Double-check the chat id.`,
      };
    }

    return { ok: true, botUsername: meBody.result.username };
  } catch (err) {
    return { ok: false, error: `Could not reach Telegram: ${err instanceof Error ? err.message : String(err)}` };
  }
}
