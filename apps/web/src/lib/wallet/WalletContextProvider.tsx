'use client';

import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { ConnectionProvider, WalletProvider, type WalletProviderProps } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { type ComponentType, type PropsWithChildren, useMemo } from 'react';

import '@solana/wallet-adapter-react-ui/styles.css';

// @solana/wallet-adapter-react(-ui) ships types built against an older
// React version than this project's @types/react — its provider
// components' children prop doesn't line up with the newer, stricter
// ReactNode type, which TS flags as "cannot be used as a JSX component"
// even though these work correctly at runtime. Re-typed narrowly here
// rather than loosening strictness project-wide for one library.
const SolanaConnectionProvider = ConnectionProvider as unknown as ComponentType<
  PropsWithChildren<{ endpoint: string }>
>;
const SolanaWalletProvider = WalletProvider as unknown as ComponentType<PropsWithChildren<WalletProviderProps>>;
const SolanaWalletModalProvider = WalletModalProvider as unknown as ComponentType<PropsWithChildren>;

const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

/**
 * Wraps the dashboard with Solana's official wallet-adapter context,
 * configured for Phantom. This is the ONLY place a wallet's signing
 * capability is ever touched — everything downstream (useWalletAdapter,
 * WalletConnectButton) goes through this provider's hooks, which delegate
 * to the Phantom browser extension itself. No private key or seed phrase
 * is ever accessible to this app's code; see the security note in
 * @pump-scalper/solana's walletAdapter.ts for why that's true by
 * construction, not by convention.
 */
export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <SolanaConnectionProvider endpoint={RPC_ENDPOINT}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <SolanaWalletModalProvider>{children}</SolanaWalletModalProvider>
      </SolanaWalletProvider>
    </SolanaConnectionProvider>
  );
}
