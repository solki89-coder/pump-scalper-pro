'use client';

import { BotStatusBadge } from '@/components/BotStatusBadge';
import { PnlChart } from '@/components/PnlChart';
import { PositionCard } from '@/components/PositionCard';
import { formatPercent, formatSol, StatCard } from '@/components/StatCard';
import { Button, Card } from '@/components/ui';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { ApiError, apiFetch, isAuthenticated } from '@/lib/api';
import { useWsSubscription } from '@/lib/useWebSocket';
import type { BotState, Position, PortfolioSummary, Trade } from '@pump-scalper/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export default function DashboardPage() {
  const router = useRouter();
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [botState, setBotState] = useState<BotState | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [p, b, pos, tr] = await Promise.all([
      apiFetch<PortfolioSummary>('/api/portfolio'),
      apiFetch<BotState>('/api/bot/status'),
      apiFetch<Position[]>('/api/positions?status=open'),
      apiFetch<Trade[]>('/api/trades?filter=ALL'),
    ]);
    setPortfolio(p);
    setBotState(b);
    setPositions(pos);
    setTrades(tr);
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }
    refresh().catch((err) => {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      }
    });
  }, [refresh, router]);

  useWsSubscription((msg) => {
    if (msg.channel === 'portfolio') setPortfolio(msg.data);
    if (msg.channel === 'bot') setBotState(msg.data);
    if (msg.channel === 'position') {
      setPositions((prev) => {
        if (msg.data.status === 'CLOSED') return prev.filter((p) => p.id !== msg.data.id);
        const exists = prev.some((p) => p.id === msg.data.id);
        return exists ? prev.map((p) => (p.id === msg.data.id ? msg.data : p)) : [msg.data, ...prev];
      });
    }
    if (msg.channel === 'trade') {
      setTrades((prev) => [msg.data, ...prev]);
    }
  });

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  function onKillSwitch() {
    if (!window.confirm('Activate the Kill Switch? This stops all new trading. Existing positions are left untouched.')) return;
    void runAction(() => apiFetch('/api/bot/kill', { method: 'POST' }));
  }

  if (!portfolio || !botState) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4 text-muted">
        Loading…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-4 pb-24">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Pump Scalper Pro</h1>
          <div className="mt-1 flex items-center gap-2">
            <BotStatusBadge status={botState.status} />
            <span className="text-xs text-muted">{botState.mode} mode</span>
          </div>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            // Client JS cannot clear an httpOnly cookie itself — the
            // server's /auth/logout does that. Navigate regardless of
            // whether the call succeeds; a stale cookie with no valid
            // session is harmless, but a user stuck on a page that
            // silently failed to sign them out is not.
            void apiFetch('/auth/logout', { method: 'POST' }).finally(() => router.push('/login'));
          }}
        >
          Sign out
        </Button>
      </header>

      <div className="mb-4">
        <WalletConnectButton />
      </div>

      {notice && (
        <Card className="mb-4 border-negative/40 bg-negative/10 text-sm text-negative">{notice}</Card>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void runAction(() => apiFetch('/api/bot/start', { method: 'POST' }))}>
          Start
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void runAction(() => apiFetch('/api/bot/stop', { method: 'POST' }))}>
          Stop
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void runAction(() => apiFetch('/api/bot/mode/paper', { method: 'POST' }))}>
          Paper Mode
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void runAction(() => apiFetch('/api/bot/mode/live', { method: 'POST' }))}
          title="Autonomous live trading is not offered. Manual live trades (wallet-signed via Phantom) are a separate flow, not built into this reduced dashboard yet."
        >
          Autonomous Live (disabled)
        </Button>
        <Button variant="destructive" disabled={busy} onClick={onKillSwitch} className="ml-auto">
          Kill Switch
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="SOL Balance" value={`${portfolio.solBalance.toFixed(4)} SOL`} />
        <StatCard label="Daily PnL" value={formatSol(portfolio.dailyPnlSol)} tone={portfolio.dailyPnlSol >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Total PnL" value={formatSol(portfolio.totalPnlSol)} tone={portfolio.totalPnlSol >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Open Positions" value={String(portfolio.openPositions)} />
        <StatCard label="Trades Today" value={String(portfolio.tradesToday)} />
        <StatCard label="Win Rate" value={`${portfolio.winRate.toFixed(1)}%`} />
        <StatCard label="Max Drawdown" value={formatPercent(-portfolio.maxDrawdownPercent)} tone="negative" />
      </div>

      <div className="mb-6">
        <PnlChart trades={trades} />
      </div>

      <h2 className="mb-2 text-sm font-medium text-muted">Open Positions</h2>
      {positions.length === 0 ? (
        <Card className="text-sm text-muted">No open positions.</Card>
      ) : (
        <div className="flex flex-col gap-2">
          {positions.map((p) => (
            <PositionCard key={p.id} position={p} />
          ))}
        </div>
      )}
    </main>
  );
}
