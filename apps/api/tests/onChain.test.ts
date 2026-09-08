import type { Connection, ParsedTransactionWithMeta } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { getMintDecimals, SolanaTransactionVerifier } from '../src/execution/onChain.js';

const MINT = Keypair.generate().publicKey.toBase58();

describe('getMintDecimals', () => {
  it('reads decimals from a parsed mint account', async () => {
    const connection = {
      getParsedAccountInfo: vi.fn().mockResolvedValue({ value: { data: { parsed: { info: { decimals: 6 } } } } }),
    } as unknown as Connection;
    expect(await getMintDecimals(connection, MINT)).toBe(6);
  });

  it('throws a clear error when the account cannot be parsed as a mint', async () => {
    const connection = { getParsedAccountInfo: vi.fn().mockResolvedValue({ value: null }) } as unknown as Connection;
    await expect(getMintDecimals(connection, MINT)).rejects.toThrow('Could not read decimals');
  });
});

describe('SolanaTransactionVerifier.verifySwap', () => {
  const userPubkey = Keypair.generate().publicKey;

  function fakeTx(overrides: Partial<ParsedTransactionWithMeta> = {}, metaOverrides: Record<string, unknown> = {}): ParsedTransactionWithMeta {
    return {
      slot: 100,
      blockTime: 1_700_000_000,
      transaction: {
        message: { accountKeys: [{ pubkey: userPubkey }] },
        signatures: ['sig1'],
      },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [2_000_000_000],
        postBalances: [1_900_000_000], // spent 0.1 SOL
        preTokenBalances: [],
        postTokenBalances: [
          { accountIndex: 1, mint: MINT, owner: userPubkey.toBase58(), uiTokenAmount: { amount: '1000000', decimals: 6, uiAmount: 1_000_000, uiAmountString: '1000000' } },
        ],
        ...metaOverrides,
      },
      ...overrides,
    } as unknown as ParsedTransactionWithMeta;
  }

  it('computes SOL and token balance deltas for the signer', async () => {
    const connection = { getParsedTransaction: vi.fn().mockResolvedValue(fakeTx()) } as unknown as Connection;
    const verifier = new SolanaTransactionVerifier(connection);
    const details = await verifier.verifySwap('sig1', userPubkey.toBase58(), MINT);
    expect(details).not.toBeNull();
    expect(details!.solLamportsDelta).toBe(-100_000_000);
    expect(details!.tokenAmountDelta).toBe(1_000_000);
    expect(details!.feesSolPaid).toBeCloseTo(0.000005, 9);
  });

  it('returns null for a missing transaction', async () => {
    const connection = { getParsedTransaction: vi.fn().mockResolvedValue(null) } as unknown as Connection;
    const verifier = new SolanaTransactionVerifier(connection);
    expect(await verifier.verifySwap('sig1', userPubkey.toBase58(), MINT)).toBeNull();
  });

  it('returns null for a transaction that failed on-chain', async () => {
    const connection = {
      getParsedTransaction: vi.fn().mockResolvedValue(fakeTx({}, { err: { InstructionError: [] } })),
    } as unknown as Connection;
    const verifier = new SolanaTransactionVerifier(connection);
    expect(await verifier.verifySwap('sig1', userPubkey.toBase58(), MINT)).toBeNull();
  });

  it('returns null when the given public key never signed/appears in the transaction', async () => {
    const connection = { getParsedTransaction: vi.fn().mockResolvedValue(fakeTx()) } as unknown as Connection;
    const verifier = new SolanaTransactionVerifier(connection);
    const someoneElse = Keypair.generate().publicKey.toBase58();
    expect(await verifier.verifySwap('sig1', someoneElse, MINT)).toBeNull();
  });

  it('computes a negative token delta for a sell (token balance decreasing)', async () => {
    const tx = fakeTx(
      {},
      {
        preBalances: [1_900_000_000],
        postBalances: [2_050_000_000], // received 0.15 SOL
        preTokenBalances: [
          { accountIndex: 1, mint: MINT, owner: userPubkey.toBase58(), uiTokenAmount: { amount: '1000000', decimals: 6, uiAmount: 1_000_000, uiAmountString: '1000000' } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: MINT, owner: userPubkey.toBase58(), uiTokenAmount: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' } },
        ],
      },
    );
    const connection = { getParsedTransaction: vi.fn().mockResolvedValue(tx) } as unknown as Connection;
    const verifier = new SolanaTransactionVerifier(connection);
    const details = await verifier.verifySwap('sig1', userPubkey.toBase58(), MINT);
    expect(details!.tokenAmountDelta).toBe(-1_000_000);
    expect(details!.solLamportsDelta).toBe(150_000_000);
  });
});
