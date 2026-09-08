import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { ReadOnlyWalletReader, type BalanceSource } from '../src/walletReader.js';

const SOME_PUBKEY = Keypair.generate().publicKey.toBase58();
const SOME_MINT = 'So11111111111111111111111111111111111111112'; // wrapped SOL mint, a well-known valid address

describe('ReadOnlyWalletReader', () => {
  it('converts lamports to SOL', async () => {
    const connection: BalanceSource = {
      getBalance: vi.fn().mockResolvedValue(2_500_000_000),
      getParsedTokenAccountsByOwner: vi.fn(),
    } as unknown as BalanceSource;
    const reader = new ReadOnlyWalletReader(connection);
    const balance = await reader.getSolBalance(SOME_PUBKEY);
    expect(balance).toBeCloseTo(2.5, 9);
    expect(connection.getBalance).toHaveBeenCalledWith(new PublicKey(SOME_PUBKEY));
  });

  it('returns 0 when the token account does not exist', async () => {
    const connection: BalanceSource = {
      getBalance: vi.fn(),
      getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
    } as unknown as BalanceSource;
    const reader = new ReadOnlyWalletReader(connection);
    const balance = await reader.getTokenBalance(SOME_PUBKEY, SOME_MINT);
    expect(balance).toBe(0);
  });

  it('reads the parsed uiAmount when the token account exists', async () => {
    const connection: BalanceSource = {
      getBalance: vi.fn(),
      getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({
        value: [
          {
            account: {
              data: { parsed: { info: { tokenAmount: { uiAmount: 4200 } } } },
            },
          },
        ],
      }),
    } as unknown as BalanceSource;
    const reader = new ReadOnlyWalletReader(connection);
    const balance = await reader.getTokenBalance(SOME_PUBKEY, SOME_MINT);
    expect(balance).toBe(4200);
  });
});
