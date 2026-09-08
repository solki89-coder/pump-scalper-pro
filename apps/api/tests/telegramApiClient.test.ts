import { describe, expect, it, vi } from 'vitest';
import { testTelegramConnection, type FetchLike } from '../src/telegram/telegramApiClient.js';

function fakeFetch(responses: Record<string, { ok: boolean; body: unknown }>): FetchLike {
  return vi.fn(async (url: string) => {
    const key = url.includes('/getMe') ? 'getMe' : 'sendMessage';
    const { ok, body } = responses[key]!;
    return { ok, status: ok ? 200 : 400, json: async () => body };
  }) as unknown as FetchLike;
}

describe('testTelegramConnection', () => {
  it('returns ok with the bot username when both the token and chat id are valid', async () => {
    const fetchImpl = fakeFetch({
      getMe: { ok: true, body: { ok: true, result: { username: 'pump_scalper_bot' } } },
      sendMessage: { ok: true, body: { ok: true } },
    });
    const result = await testTelegramConnection('tok', 'chat1', fetchImpl);
    expect(result).toEqual({ ok: true, botUsername: 'pump_scalper_bot' });
  });

  it('reports an invalid token without ever attempting to send a message', async () => {
    const fetchImpl = fakeFetch({
      getMe: { ok: false, body: { ok: false, description: 'Unauthorized' } },
      sendMessage: { ok: true, body: { ok: true } },
    });
    const result = await testTelegramConnection('bad-token', 'chat1', fetchImpl);
    expect(result).toEqual({ ok: false, error: 'Unauthorized' });
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('distinguishes "token is fine, chat id is wrong" from an invalid token', async () => {
    const fetchImpl = fakeFetch({
      getMe: { ok: true, body: { ok: true, result: { username: 'pump_scalper_bot' } } },
      sendMessage: { ok: false, body: { ok: false, description: 'chat not found' } },
    });
    const result = await testTelegramConnection('tok', 'wrong-chat', fetchImpl);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('@pump_scalper_bot');
    expect((result as { ok: false; error: string }).error).toContain('chat not found');
  });

  it('returns a clean failure result instead of throwing when the network call itself fails', async () => {
    const fetchImpl: FetchLike = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.telegram.org'));
    const result = await testTelegramConnection('tok', 'chat1', fetchImpl);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('Could not reach Telegram');
  });

  it('returns a clean failure result when a response body is not valid JSON (e.g. a proxy error page)', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => {
        throw new SyntaxError("Unexpected token 'H', \"Host not i\"... is not valid JSON");
      },
    });
    const result = await testTelegramConnection('tok', 'chat1', fetchImpl);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain('Could not reach Telegram');
  });
});
