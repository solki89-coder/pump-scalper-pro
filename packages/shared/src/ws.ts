import { z } from 'zod';
import { TokenSnapshotSchema } from './token.js';
import { TokenScoresSchema } from './scoring.js';
import { SignalSchema } from './signal.js';
import { PositionSchema } from './position.js';
import { TradeSchema } from './trade.js';
import { BotStateSchema, PortfolioSummarySchema } from './botStatus.js';

export const WsMessageSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('token'), event: z.literal('update'), data: TokenSnapshotSchema }),
  z.object({ channel: z.literal('score'), event: z.literal('update'), data: TokenScoresSchema }),
  z.object({ channel: z.literal('signal'), event: z.literal('new'), data: SignalSchema }),
  z.object({ channel: z.literal('position'), event: z.enum(['opened', 'updated', 'closed']), data: PositionSchema }),
  z.object({ channel: z.literal('trade'), event: z.literal('new'), data: TradeSchema }),
  z.object({ channel: z.literal('bot'), event: z.literal('status'), data: BotStateSchema }),
  z.object({ channel: z.literal('portfolio'), event: z.literal('update'), data: PortfolioSummarySchema }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;
