import type { Transaction, VersionedTransaction } from '@solana/web3.js';

export type SignableTransaction = Transaction | VersionedTransaction;

/**
 * Abstraction over a connected Solana wallet (Phantom via
 * @solana/wallet-adapter-*, concretely wired in Phase 12 inside apps/web).
 *
 * SECURITY — this interface has exactly one legitimate implementation
 * location: the browser, backed by the user's own wallet extension.
 *   - The backend (apps/api) MUST NEVER implement `signTransaction` or
 *     `sendTransaction` with a locally held private key or seed phrase.
 *   - No implementation of this interface may serialize, log, or transmit
 *     a private key or seed phrase anywhere — not to the API, not to
 *     Telegram, not to system_events.
 * The backend's only wallet capability is read-only balance lookups
 * (see `ReadOnlyWalletReader` in walletReader.ts), which need nothing more
 * than a public key.
 */
export interface WalletAdapter {
  connectWallet(): Promise<string>;
  disconnectWallet(): Promise<void>;
  getPublicKey(): string | null;
  getBalance(): Promise<number>;
  getTokenBalance(mint: string): Promise<number>;
  signTransaction<T extends SignableTransaction>(transaction: T): Promise<T>;
  sendTransaction(transaction: SignableTransaction): Promise<string>;
}
