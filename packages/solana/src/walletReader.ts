import { PublicKey, type Connection } from '@solana/web3.js';
import { lamportsToSol } from './lamports.js';

/** The minimal slice of `Connection` this reader needs — makes it trivially fakeable in tests. */
export type BalanceSource = Pick<Connection, 'getBalance' | 'getParsedTokenAccountsByOwner'>;

/**
 * Read-only wallet balance lookups by public key. No signing capability
 * exists here on purpose — the backend never holds or needs a private key.
 */
export class ReadOnlyWalletReader {
  constructor(private readonly connection: BalanceSource) {}

  async getSolBalance(publicKey: string): Promise<number> {
    const lamports = await this.connection.getBalance(new PublicKey(publicKey));
    return lamportsToSol(lamports);
  }

  async getTokenBalance(publicKey: string, mint: string): Promise<number> {
    const owner = new PublicKey(publicKey);
    const mintKey = new PublicKey(mint);
    const resp = await this.connection.getParsedTokenAccountsByOwner(owner, { mint: mintKey });
    const account = resp.value[0];
    if (!account) return 0;
    const uiAmount = account.account.data.parsed?.info?.tokenAmount?.uiAmount;
    return typeof uiAmount === 'number' ? uiAmount : 0;
  }
}
