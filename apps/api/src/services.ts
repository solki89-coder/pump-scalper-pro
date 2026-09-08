import { PaperExecutionEngine } from '@pump-scalper/core';
import { createPosition, getPosition, updatePosition } from './db/repositories/positions.js';
import { createTrade } from './db/repositories/trades.js';
import { PaperTradingService } from './trading/paperTradingService.js';

/**
 * Process-wide singletons. Simple module-level construction is enough here
 * — there's exactly one Postgres pool and one paper execution engine for
 * the whole API process, and every repository function already reads that
 * shared pool (db/client.ts), so there's no per-request state to manage.
 */
export const paperTradingService = new PaperTradingService(
  new PaperExecutionEngine(),
  { createPosition, updatePosition, getPosition },
  { createTrade },
);
