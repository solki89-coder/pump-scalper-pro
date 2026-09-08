import type { Position } from '@pump-scalper/shared';
import { Card } from './ui';
import { formatPercent, formatSol } from './StatCard';
import { cn } from '@/lib/cn';

export function PositionCard({ position }: { position: Position }) {
  const isUp = position.unrealizedPnlSol >= 0;
  return (
    <Card className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{position.tokenSymbol}</p>
        <p className="truncate text-xs text-muted">{position.tokenName}</p>
        <p className="mt-1 text-xs text-muted">
          Entry {position.entryPrice.toPrecision(4)} &middot; SL {position.stopLossPercent}%
          {position.trailingStopPercent !== null ? ` · TSL ${position.trailingStopPercent}%` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn('font-semibold tabular-nums', isUp ? 'text-positive' : 'text-negative')}>
          {formatSol(position.unrealizedPnlSol)}
        </p>
        <p className={cn('text-xs tabular-nums', isUp ? 'text-positive' : 'text-negative')}>
          {formatPercent(position.unrealizedPnlPercent)}
        </p>
      </div>
    </Card>
  );
}
