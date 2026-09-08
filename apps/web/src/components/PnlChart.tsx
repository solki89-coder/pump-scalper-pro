'use client';

import type { Trade } from '@pump-scalper/shared';
import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardTitle } from './ui';

export function PnlChart({ trades }: { trades: Trade[] }) {
  const series = useMemo(() => {
    const closed = trades
      .filter((t) => t.side === 'SELL' && t.pnlSol !== null)
      .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());
    let cumulative = 0;
    return closed.map((t, i) => {
      cumulative += t.pnlSol ?? 0;
      return { index: i + 1, pnl: Number(cumulative.toFixed(6)) };
    });
  }, [trades]);

  return (
    <Card>
      <CardTitle>Cumulative PnL</CardTitle>
      <div className="mt-2 h-40">
        {series.length < 2 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted">Not enough closed trades yet</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="index" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: '#12141a', border: '1px solid #22252e', borderRadius: 8, fontSize: 12 }}
                labelFormatter={() => ''}
                formatter={(value: number) => [`${value.toFixed(4)} SOL`, 'Cumulative PnL']}
              />
              <Area type="monotone" dataKey="pnl" stroke="#7c5cff" strokeWidth={2} fill="url(#pnlFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
