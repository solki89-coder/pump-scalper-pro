import type { BotStatus } from '@pump-scalper/shared';
import { Badge } from './ui';

const TONE_BY_STATUS: Record<BotStatus, 'neutral' | 'positive' | 'negative' | 'warning' | 'accent'> = {
  PAPER: 'accent',
  READY: 'neutral',
  RUNNING: 'positive',
  STOPPED: 'warning',
  KILL_SWITCH: 'negative',
};

export function BotStatusBadge({ status }: { status: BotStatus }) {
  return <Badge tone={TONE_BY_STATUS[status]}>{status}</Badge>;
}
