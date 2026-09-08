import { Card, CardTitle } from './ui';
import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <p className={cn('mt-1 text-xl font-semibold tabular-nums', tone === 'positive' && 'text-positive', tone === 'negative' && 'text-negative')}>
        {value}
      </p>
    </Card>
  );
}

export function formatSol(value: number, digits = 4): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)} SOL`;
}

export function formatPercent(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}
