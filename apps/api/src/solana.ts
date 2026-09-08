import { createConnection } from '@pump-scalper/solana';
import { RpcHealthMonitor } from '@pump-scalper/solana/server';
import type { Connection } from '@solana/web3.js';
import { loadConfig } from './config.js';

let connection: Connection | undefined;
let healthMonitor: RpcHealthMonitor | undefined;

/** The single shared Solana RPC connection for the whole API process. */
export function getConnection(): Connection {
  if (!connection) {
    const config = loadConfig();
    connection = createConnection({ rpcUrl: config.SOLANA_RPC_URL, wsUrl: config.SOLANA_WS_URL });
  }
  return connection;
}

/** Lazily-created health monitor for the shared connection. Call `.start()` at boot. */
export function getHealthMonitor(): RpcHealthMonitor {
  if (!healthMonitor) {
    healthMonitor = new RpcHealthMonitor({ getSlot: () => getConnection().getSlot() });
  }
  return healthMonitor;
}
