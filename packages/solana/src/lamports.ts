import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export { LAMPORTS_PER_SOL };

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}
