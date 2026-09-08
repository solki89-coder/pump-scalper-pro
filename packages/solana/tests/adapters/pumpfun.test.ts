import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { extractCreationEvent, PumpFunTokenDiscovery, type CreationTxSource } from '../../src/adapters/pumpfun.js';

const FEE_PAYER = Keypair.generate().publicKey;

// Only the fields `extractCreationEvent` actually reads are populated —
// the rest of the real ParsedTransactionWithMeta shape is irrelevant here.
function fakeTx(metaOverrides: Record<string, unknown> = {}): ParsedTransactionWithMeta {
  return {
    slot: 100,
    blockTime: 1_700_000_000,
    transaction: {
      message: { accountKeys: [{ pubkey: FEE_PAYER }] },
      signatures: ['sig1'],
    },
    meta: {
      preTokenBalances: [],
      postTokenBalances: [
        { accountIndex: 1, mint: 'NewMint11111111111111111111111111111111111', owner: 'x', uiTokenAmount: { amount: '1', decimals: 6, uiAmount: 1, uiAmountString: '1' } },
      ],
      err: null,
      ...metaOverrides,
    },
  } as unknown as ParsedTransactionWithMeta;
}

describe('extractCreationEvent', () => {
  it('extracts the mint that is new in postTokenBalances and the fee payer as creator', () => {
    const event = extractCreationEvent('sig1', fakeTx());
    expect(event).toEqual({
      signature: 'sig1',
      slot: 100,
      blockTime: 1_700_000_000,
      mint: 'NewMint11111111111111111111111111111111111',
      creator: FEE_PAYER.toBase58(),
    });
  });

  it('returns null when there is no new mint (e.g. an unrelated transaction)', () => {
    const tx = fakeTx({
      preTokenBalances: [{ accountIndex: 1, mint: 'Existing1111111111111111111111111111111111', owner: 'x', uiTokenAmount: { amount: '1', decimals: 6, uiAmount: 1, uiAmountString: '1' } }],
      postTokenBalances: [{ accountIndex: 1, mint: 'Existing1111111111111111111111111111111111', owner: 'x', uiTokenAmount: { amount: '2', decimals: 6, uiAmount: 2, uiAmountString: '2' } }],
    });
    expect(extractCreationEvent('sig1', tx)).toBeNull();
  });

  it('returns null for a missing transaction (e.g. not yet confirmed)', () => {
    expect(extractCreationEvent('sig1', null)).toBeNull();
  });
});

describe('PumpFunTokenDiscovery', () => {
  it('subscribes to the pump.fun program id and emits "discovered" only for Create-instruction logs that resolve to a new mint', async () => {
    let capturedCallback: ((logs: { err: unknown; logs: string[]; signature: string }) => void) | null = null;
    const source: CreationTxSource = {
      onLogs: vi.fn((_pid, cb) => {
        capturedCallback = cb as never;
        return 42;
      }),
      removeOnLogsListener: vi.fn().mockResolvedValue(undefined),
      getParsedTransaction: vi.fn().mockResolvedValue(fakeTx()),
    };

    const discovery = new PumpFunTokenDiscovery(source);
    const discovered = vi.fn();
    discovery.on('discovered', discovered);

    discovery.start();
    expect(source.onLogs).toHaveBeenCalledTimes(1);

    // Not a Create instruction — ignored.
    capturedCallback!({ err: null, logs: ['Program log: Instruction: Sell'], signature: 'sigA' });
    await flush();
    expect(discovered).not.toHaveBeenCalled();

    // A Create instruction — resolved via getParsedTransaction.
    capturedCallback!({ err: null, logs: ['Program log: Instruction: Create'], signature: 'sig1' });
    await flush();
    expect(source.getParsedTransaction).toHaveBeenCalledWith('sig1', { maxSupportedTransactionVersion: 0 });
    expect(discovered).toHaveBeenCalledTimes(1);
    expect(discovered.mock.calls[0]?.[0]).toMatchObject({ mint: 'NewMint11111111111111111111111111111111111' });

    await discovery.stop();
    expect(source.removeOnLogsListener).toHaveBeenCalledWith(42);
  });

  it('ignores log entries that carry a transaction error', async () => {
    let capturedCallback: ((logs: { err: unknown; logs: string[]; signature: string }) => void) | null = null;
    const source: CreationTxSource = {
      onLogs: vi.fn((_pid, cb) => {
        capturedCallback = cb as never;
        return 1;
      }),
      removeOnLogsListener: vi.fn().mockResolvedValue(undefined),
      getParsedTransaction: vi.fn(),
    };
    const discovery = new PumpFunTokenDiscovery(source);
    discovery.start();
    capturedCallback!({ err: { InstructionError: [] }, logs: ['Program log: Instruction: Create'], signature: 'sigFail' });
    await flush();
    expect(source.getParsedTransaction).not.toHaveBeenCalled();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
