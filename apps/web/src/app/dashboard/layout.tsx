import { WalletContextProvider } from '@/lib/wallet/WalletContextProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <WalletContextProvider>{children}</WalletContextProvider>;
}
