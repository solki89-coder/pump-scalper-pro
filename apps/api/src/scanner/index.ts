import { DexScreenerAdapter } from '@pump-scalper/solana';
import { PumpFunTokenDiscovery } from '@pump-scalper/solana/server';
import pino from 'pino';
import { loadConfig } from '../config.js';
import { getToken, upsertToken } from '../db/repositories/tokens.js';
import { getConnection } from '../solana.js';
import { getTelegramAlerts } from '../telegram/index.js';
import { TokenScanner } from './tokenScanner.js';

export { TokenScanner } from './tokenScanner.js';
export type { DiscoverySourcePort, MarketDataPort, ScannerLogger, TokenRepositoryPort } from './tokenScanner.js';

/** Wires the real Solana connection, DexScreener adapter, and Postgres tokens repo into a runnable TokenScanner. */
export function createTokenScanner(): TokenScanner {
  const config = loadConfig();
  const connection = getConnection();
  const discovery = new PumpFunTokenDiscovery(connection);
  const market = new DexScreenerAdapter(config.DEXSCREENER_API_BASE);
  const logger = pino({ level: config.LOG_LEVEL, name: 'scanner' });
  return new TokenScanner(
    discovery,
    market,
    { upsertToken, getToken },
    { info: (m) => logger.info(m), error: (m, err) => logger.error({ err }, m) },
    15_000,
    getTelegramAlerts(),
  );
}
