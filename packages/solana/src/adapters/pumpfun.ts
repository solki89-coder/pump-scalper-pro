import { EventEmitter } from 'node:events';
import type { Connection, Context, Logs, ParsedTransactionWithMeta, PublicKey as PublicKeyType } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

/**
 * Pump.fun's on-chain program (Anchor-based), confirmed against Solscan and
 * multiple independent open-source bots as of writing:
 * https://solscan.io/account/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
 */
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/**
 * Anchor programs log their instruction name via `msg!` by default —
 * "Program log: Instruction: Create" is the observed, documented signal
 * multiple independent pump.fun bots key off of (Chainstack's guide,
 * bitman09/pumpfun-sniper-bot, sapperskills' copybot, among others) for
 * detecting a new token launch in `logsSubscribe` output.
 */
const CREATE_LOG_PATTERN = /Instruction:\s*Create\b/;

export interface TokenCreationEvent {
  signature: string;
  slot: number;
  blockTime: number | null;
  mint: string;
  creator: string;
}

/**
 * The minimal slice of `Connection` this adapter needs, so it's fakeable in
 * tests without a live RPC. `Connection` itself satisfies this shape.
 */
export interface CreationTxSource {
  onLogs(
    filter: PublicKeyType,
    callback: (logs: Logs, ctx: Context) => void,
    commitment?: Parameters<Connection['onLogs']>[2],
  ): number;
  removeOnLogsListener(id: number): Promise<void>;
  getParsedTransaction(
    signature: string,
    config?: Parameters<Connection['getParsedTransaction']>[1],
  ): Promise<ParsedTransactionWithMeta | null>;
}

/**
 * Detects new pump.fun token creations in real time via the official
 * Solana `logsSubscribe` RPC method (no third-party API). Only what's
 * *generically* derivable from any Solana transaction is extracted here —
 * mint (the newly appearing entry in `postTokenBalances` with no matching
 * `preTokenBalances` entry) and creator (the transaction fee payer).
 *
 * Human-readable name/symbol/URI and bonding-curve reserve state live in
 * pump.fun's own instruction args / `CreateEvent`, which requires decoding
 * against pump.fun's (unofficial, reverse-engineered) Anchor IDL. This
 * adapter deliberately does NOT guess that byte layout — see
 * `PumpFunEventDecoder` below. Name/symbol arrive instead via the
 * DexScreener enrichment step (dexscreener.ts) once the pair is indexed.
 */
export class PumpFunTokenDiscovery extends EventEmitter {
  private subscriptionId: number | null = null;

  constructor(private readonly source: CreationTxSource) {
    super();
  }

  start(): void {
    if (this.subscriptionId !== null) return;
    this.subscriptionId = this.source.onLogs(
      new PublicKey(PUMP_FUN_PROGRAM_ID),
      (logs) => {
        if (logs.err) return;
        if (!logs.logs.some((line) => CREATE_LOG_PATTERN.test(line))) return;
        void this.handleSignature(logs.signature);
      },
      'confirmed',
    );
  }

  async stop(): Promise<void> {
    if (this.subscriptionId === null) return;
    await this.source.removeOnLogsListener(this.subscriptionId);
    this.subscriptionId = null;
  }

  private async handleSignature(signature: string): Promise<void> {
    try {
      const tx = await this.source.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      const event = extractCreationEvent(signature, tx);
      if (event) this.emit('discovered', event);
    } catch (err) {
      this.emit('error', err as Error);
    }
  }
}

/** Exported standalone so it can be unit tested against fixture transactions without a live subscription. */
export function extractCreationEvent(
  signature: string,
  tx: ParsedTransactionWithMeta | null,
): TokenCreationEvent | null {
  if (!tx || !tx.meta) return null;

  const pre = new Set((tx.meta.preTokenBalances ?? []).map((b) => b.mint));
  const newMint = (tx.meta.postTokenBalances ?? []).find((b) => !pre.has(b.mint));
  if (!newMint) return null;

  const feePayer = tx.transaction.message.accountKeys[0]?.pubkey;
  if (!feePayer) return null;

  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    mint: newMint.mint,
    creator: feePayer.toBase58(),
  };
}
