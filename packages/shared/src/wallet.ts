import { z } from 'zod';

export const WalletInfoSchema = z.object({
  userId: z.string().uuid(),
  publicKey: z.string().nullable(),
  connected: z.boolean(),
  balanceSol: z.number().nonnegative().nullable(),
  tradingAllocationSol: z.number().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type WalletInfo = z.infer<typeof WalletInfoSchema>;
