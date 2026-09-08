'use client';

import { Badge, Button, Card, CardTitle } from '@/components/ui';
import { ApiError, apiFetch, isAuthenticated } from '@/lib/api';
import type { TelegramSettings, TelegramTestConnectionResult } from '@pump-scalper/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<TelegramSettings | null>(null);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'positive' | 'negative'; text: string } | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    apiFetch<TelegramSettings>('/api/settings/telegram')
      .then((data) => {
        setSettings(data);
        setChatId(data.chatId ?? '');
        setEnabled(data.enabled);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.push('/login');
      });
  }, [router]);

  async function onTest() {
    if (!botToken && !settings?.hasToken) {
      setNotice({ tone: 'negative', text: 'Enter a bot token first — there is nothing saved yet to test.' });
      return;
    }
    if (!chatId) {
      setNotice({ tone: 'negative', text: 'Enter a chat id to test against.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiFetch<TelegramTestConnectionResult>('/api/settings/telegram/test', {
        method: 'POST',
        body: JSON.stringify({ botToken: botToken || undefined, chatId }),
      });
      setNotice(
        result.ok
          ? { tone: 'positive', text: `Connected — sent a test message via @${result.botUsername}.` }
          : { tone: 'negative', text: result.error },
      );
    } catch (err) {
      setNotice({ tone: 'negative', text: err instanceof ApiError ? err.message : 'Test failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!chatId) {
      setNotice({ tone: 'negative', text: 'Chat id is required.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await apiFetch<TelegramSettings>('/api/settings/telegram', {
        method: 'PUT',
        body: JSON.stringify({ botToken: botToken || undefined, chatId, enabled }),
      });
      setSettings(saved);
      setBotToken('');
      setNotice({ tone: 'positive', text: saved.enabled ? 'Saved — the bot is now live, no restart needed.' : 'Saved — Telegram is disabled.' });
    } catch (err) {
      setNotice({ tone: 'negative', text: err instanceof ApiError ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4 text-muted">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg p-4 pb-24">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Button variant="ghost" onClick={() => router.push('/dashboard')}>
          Back to Dashboard
        </Button>
      </header>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Telegram Bot</CardTitle>
          <Badge tone={settings.running ? 'positive' : 'neutral'}>{settings.running ? 'Running' : 'Not running'}</Badge>
        </div>

        {notice && (
          <div className={`mb-3 rounded-lg border p-3 text-sm ${notice.tone === 'positive' ? 'border-positive/40 bg-positive/10 text-positive' : 'border-negative/40 bg-negative/10 text-negative'}`}>
            {notice.text}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Bot Token</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={settings.hasToken ? '•••• already saved — leave blank to keep it' : 'From @BotFather'}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Chat ID</span>
            <input
              type="text"
              placeholder="e.g. 123456789"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            <span>Enabled</span>
          </label>

          <p className="text-xs text-muted">
            Only messages from this exact chat id can control the bot — the token alone is never enough. Find your
            chat id by messaging the bot once, then visiting{' '}
            <code className="rounded bg-white/10 px-1">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>.
          </p>

          <div className="mt-1 flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void onTest()}>
              Test Connection
            </Button>
            <Button disabled={busy} onClick={() => void onSave()}>
              Save
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
