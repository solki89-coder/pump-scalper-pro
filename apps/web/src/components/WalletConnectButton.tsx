'use client';

import { useWalletAdapter } from '@/lib/wallet/useWalletAdapter';
import { apiFetch, ApiError } from '@/lib/api';
import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui';

function truncate(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Connects Phantom via the wallet adapter, reads the SOL balance directly
 * from chain (client-side, read-only), and syncs only the PUBLIC key to
 * the backend (POST /api/wallet/connect) — never a private key or seed
 * phrase, per the security rules in packages/solana/src/walletAdapter.ts.
 */
export function WalletConnectButton() {
  const { connected, publicKey } = useWallet();
  const adapter = useWalletAdapter();
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!connected) return;
    try {
      const b = await adapter.getBalance();
      setBalance(b);
    } catch {
      // A balance read can fail transiently (RPC hiccup) — leave the last known value shown.
    }
  }, [connected, adapter]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const pk = await adapter.connectWallet();
      await apiFetch('/api/wallet/connect', { method: 'POST', body: JSON.stringify({ publicKey: pk, label: 'main' }) });
      await refreshBalance();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to connect wallet');
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    setBusy(true);
    try {
      await adapter.disconnectWallet();
      await apiFetch('/api/wallet/disconnect', { method: 'POST', body: JSON.stringify({ label: 'main' }) });
      setBalance(null);
    } finally {
      setBusy(false);
    }
  }

  if (connected && publicKey) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{truncate(publicKey.toBase58())}</span>
        <span className="font-medium">{balance !== null ? `${balance.toFixed(3)} SOL` : '…'}</span>
        <Button variant="outline" disabled={busy} onClick={() => void onDisconnect()}>
          Disconnect
        </Button>
        {error && <span className="text-negative">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void onConnect()}>
        Connect Phantom
      </Button>
      {error && <span className="text-xs text-negative">{error}</span>}
    </div>
  );
}
