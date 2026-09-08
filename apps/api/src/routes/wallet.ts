import { PublicKey } from '@solana/web3.js';
import { ReadOnlyWalletReader } from '@pump-scalper/solana';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getWallet, upsertWallet } from '../db/repositories/wallets.js';
import { createSystemEvent } from '../db/repositories/systemEvents.js';
import { getConnection } from '../solana.js';

const ConnectSchema = z.object({
  publicKey: z.string().refine((v) => {
    try {
      new PublicKey(v);
      return true;
    } catch {
      return false;
    }
  }, 'Not a valid Solana public key'),
  label: z.enum(['main', 'trading']).default('main'),
});

/**
 * Read-only by construction: this route only ever receives a PUBLIC key
 * (validated as one above) supplied by the browser's own wallet extension
 * (Phantom, wired in Phase 12) after the user approves a connection there.
 * Nothing here can request a signature or touch a private key — see the
 * security note in packages/solana/src/walletAdapter.ts.
 */
export default async function walletRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/wallet', { preHandler: fastify.authenticate }, async (request) => {
    const label = z.enum(['main', 'trading']).default('main').parse((request.query as { label?: string }).label);
    const wallet = await getWallet(request.userId, label);
    if (!wallet || !wallet.publicKey) {
      return { userId: request.userId, publicKey: null, connected: false, balanceSol: null, tradingAllocationSol: wallet?.tradingAllocationSol ?? 0, updatedAt: new Date().toISOString() };
    }
    const reader = new ReadOnlyWalletReader(getConnection());
    const balanceSol = await reader.getSolBalance(wallet.publicKey);
    return { userId: request.userId, publicKey: wallet.publicKey, connected: wallet.connected, balanceSol, tradingAllocationSol: wallet.tradingAllocationSol, updatedAt: wallet.updatedAt };
  });

  fastify.post('/api/wallet/connect', { preHandler: fastify.authenticate }, async (request, reply) => {
    const parsed = ConnectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    const wallet = await upsertWallet(request.userId, parsed.data.label, { publicKey: parsed.data.publicKey, connected: true });
    await createSystemEvent({ userId: request.userId, type: 'WALLET_CONNECTED', details: { label: parsed.data.label } });
    return wallet;
  });

  fastify.post('/api/wallet/disconnect', { preHandler: fastify.authenticate }, async (request) => {
    const label = z.enum(['main', 'trading']).default('main').parse((request.body as { label?: string } | undefined)?.label);
    const wallet = await upsertWallet(request.userId, label, { connected: false });
    await createSystemEvent({ userId: request.userId, type: 'WALLET_DISCONNECTED', details: { label } });
    return wallet;
  });
}
