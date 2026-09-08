import { Connection, type Commitment } from '@solana/web3.js';

export interface SolanaConnectionConfig {
  rpcUrl: string;
  wsUrl: string;
  commitment?: Commitment;
}

/**
 * Creates the single Solana RPC connection the rest of the app shares.
 * Subscriptions (logsSubscribe, accountSubscribe, programSubscribe) ride
 * the same underlying connection's WebSocket via `wsEndpoint` — no separate
 * client needed. `@solana/web3.js` reconnects its internal rpc-websockets
 * client automatically; `RpcHealthMonitor` (health.ts) is what surfaces a
 * stalled connection to the rest of the system (Telegram RPC_ERROR alert,
 * system_events log) since silent reconnects would otherwise go unnoticed.
 */
export function createConnection(config: SolanaConnectionConfig): Connection {
  return new Connection(config.rpcUrl, {
    commitment: config.commitment ?? 'confirmed',
    wsEndpoint: config.wsUrl,
  });
}
