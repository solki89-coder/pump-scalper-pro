import { z } from 'zod';
import { RiskRejectReasonSchema } from './risk.js';

export const RiskEventSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  mint: z.string().nullable(),
  strategyId: z.string().uuid().nullable(),
  reasons: z.array(RiskRejectReasonSchema),
  attemptedSizeSol: z.number().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
});
export type RiskEvent = z.infer<typeof RiskEventSchema>;

export const SystemEventTypeSchema = z.enum([
  'BOT_START',
  'BOT_STOP',
  'MODE_CHANGE',
  'STRATEGY_UPDATED',
  'RISK_CONFIG_UPDATED',
  'KILL_SWITCH_ON',
  'KILL_SWITCH_OFF',
  'RPC_ERROR',
  'RPC_RECONNECTED',
  'WALLET_CONNECTED',
  'WALLET_DISCONNECTED',
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
]);
export type SystemEventType = z.infer<typeof SystemEventTypeSchema>;

export const SystemEventSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid().nullable(),
  type: SystemEventTypeSchema,
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
});
export type SystemEvent = z.infer<typeof SystemEventSchema>;

export const TelegramAlertTypeSchema = z.enum([
  'NEW_TOKEN',
  'BUY_SIGNAL',
  'BUY_EXECUTED',
  'SELL_EXECUTED',
  'TAKE_PROFIT',
  'STOP_LOSS',
  'TRAILING_STOP',
  'RISK_REJECT',
  'DAILY_LOSS_LIMIT',
  'KILL_SWITCH',
  'RPC_ERROR',
]);
export type TelegramAlertType = z.infer<typeof TelegramAlertTypeSchema>;
