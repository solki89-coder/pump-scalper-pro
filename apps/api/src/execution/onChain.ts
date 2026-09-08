import { LAMPORTS_PER_SOL, PublicKey, type Connection } from '@solana/web3.js';

export async function getMintDecimals(connection: Connection, mint: string): Promise<number> {
  const info = await connection.getParsedAccountInfo(new PublicKey(mint));
  const data = info.value?.data;
  const decimals =
    data && typeof data === 'object' && 'parsed' in data
      ? (data as { parsed?: { info?: { decimals?: number } } }).parsed?.info?.decimals
      : undefined;
  if (typeof decimals !== 'number') throw new Error(`Could not read decimals for mint ${mint}`);
  return decimals;
}

export interface ConfirmedSwapDetails {
  slot: number;
  blockTime: number | null;
  /** Signed change in the signer's SOL balance — negative for a buy (SOL spent), positive for a sell (SOL received). */
  solLamportsDelta: number;
  /** Signed change in the signer's balance of the traded token, in UI units — positive for a buy, negative for a sell. */
  tokenAmountDelta: number;
  feesSolPaid: number;
}

export interface TransactionVerifier {
  verifySwap(signature: string, userPublicKey: string, mint: string): Promise<ConfirmedSwapDetails | null>;
}

/**
 * Reads the ACTUAL result of a swap off-chain-confirmed transaction —
 * never trusts the quote as what happened, since live execution can (and
 * does) slip from the quote. Returns null for a missing or failed
 * transaction so the caller can refuse to record a trade that didn't
 * actually happen, rather than fabricating one from the request body.
 */
export class SolanaTransactionVerifier implements TransactionVerifier {
  constructor(private readonly connection: Connection) {}

  async verifySwap(signature: string, userPublicKey: string, mint: string): Promise<ConfirmedSwapDetails | null> {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx || tx.meta?.err) return null;

    const accountKeys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
    const idx = accountKeys.indexOf(userPublicKey);
    if (idx === -1 || !tx.meta) return null;

    const solLamportsDelta = tx.meta.postBalances[idx]! - tx.meta.preBalances[idx]!;

    const preToken = tx.meta.preTokenBalances?.find((b) => b.mint === mint && b.owner === userPublicKey);
    const postToken = tx.meta.postTokenBalances?.find((b) => b.mint === mint && b.owner === userPublicKey);
    const tokenAmountDelta = (postToken?.uiTokenAmount.uiAmount ?? 0) - (preToken?.uiTokenAmount.uiAmount ?? 0);

    return {
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      solLamportsDelta,
      tokenAmountDelta,
      feesSolPaid: tx.meta.fee / LAMPORTS_PER_SOL,
    };
  }
}
