'use client';

import { ReadOnlyWalletReader, type SignableTransaction, type WalletAdapter } from '@pump-scalper/solana';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useMemo } from 'react';

/**
 * Implements @pump-scalper/solana's `WalletAdapter` interface on top of
 * @solana/wallet-adapter-react's hooks — the interface Phase 3 defined and
 * documented as browser-only. `signTransaction`/`sendTransaction` delegate
 * straight to the underlying adapter (Phantom), which is what actually
 * talks to the extension; this hook never sees a private key.
 */
export function useWalletAdapter(): WalletAdapter {
  const { connection } = useConnection();
  const {
    publicKey,
    disconnect,
    wallets,
    signTransaction: adapterSignTransaction,
    sendTransaction: adapterSendTransaction,
  } = useWallet();

  const reader = useMemo(() => new ReadOnlyWalletReader(connection), [connection]);

  const connectWallet = useCallback(async (): Promise<string> => {
    const phantom = wallets.find((w) => w.adapter.name === 'Phantom');
    if (!phantom) throw new Error('Phantom wallet adapter is not registered');
    // Connects the specific adapter directly rather than select() + the
    // context's connect() — select() triggers a React state update that
    // hasn't landed by the time connect() would run in the same call,
    // throwing WalletNotSelectedError. Reading the public key straight off
    // the adapter (set synchronously by its own connect()) sidesteps that
    // same render-timing gap; useWallet()'s publicKey/connected still
    // update shortly after via the adapter's 'connect' event, which is
    // what the UI's own re-render relies on.
    if (!phantom.adapter.connected) {
      await phantom.adapter.connect();
    }
    const pk = phantom.adapter.publicKey;
    if (!pk) throw new Error('Wallet connected but no public key was returned');
    return pk.toBase58();
  }, [wallets]);

  const disconnectWallet = useCallback(async (): Promise<void> => {
    await disconnect();
  }, [disconnect]);

  const getPublicKey = useCallback((): string | null => publicKey?.toBase58() ?? null, [publicKey]);

  const getBalance = useCallback(async (): Promise<number> => {
    if (!publicKey) throw new Error('Wallet not connected');
    return reader.getSolBalance(publicKey.toBase58());
  }, [publicKey, reader]);

  const getTokenBalance = useCallback(
    async (mint: string): Promise<number> => {
      if (!publicKey) throw new Error('Wallet not connected');
      return reader.getTokenBalance(publicKey.toBase58(), mint);
    },
    [publicKey, reader],
  );

  const signTransaction = useCallback(
    async <T extends SignableTransaction>(transaction: T): Promise<T> => {
      if (!adapterSignTransaction) throw new Error('Connected wallet does not support signTransaction');
      return adapterSignTransaction(transaction);
    },
    [adapterSignTransaction],
  );

  const sendTransaction = useCallback(
    async (transaction: SignableTransaction): Promise<string> => {
      return adapterSendTransaction(transaction, connection);
    },
    [adapterSendTransaction, connection],
  );

  return { connectWallet, disconnectWallet, getPublicKey, getBalance, getTokenBalance, signTransaction, sendTransaction };
}
