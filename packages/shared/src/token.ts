import { z } from 'zod';

export const BondingCurveStatusSchema = z.enum(['ACTIVE', 'GRADUATING', 'GRADUATED', 'UNKNOWN']);
export type BondingCurveStatus = z.infer<typeof BondingCurveStatusSchema>;

export const GraduationStatusSchema = z.enum(['NOT_GRADUATED', 'GRADUATED', 'UNKNOWN']);
export type GraduationStatus = z.infer<typeof GraduationStatusSchema>;

/**
 * Point-in-time snapshot of a discovered token. Populated by the scanner
 * from on-chain data plus (when configured) a market data adapter.
 * Fields the configured data sources cannot supply are `null`, never guessed.
 */
export const TokenSnapshotSchema = z.object({
  mint: z.string().min(32).max(64),
  name: z.string(),
  symbol: z.string(),
  creator: z.string().min(32).max(64),
  ageSeconds: z.number().nonnegative(),
  priceSol: z.number().nonnegative(),
  marketCapSol: z.number().nonnegative().nullable(),
  liquiditySol: z.number().nonnegative().nullable(),
  volumeSol5m: z.number().nonnegative().nullable(),
  buys5m: z.number().int().nonnegative().nullable(),
  sells5m: z.number().int().nonnegative().nullable(),
  uniqueBuyers5m: z.number().int().nonnegative().nullable(),
  uniqueSellers5m: z.number().int().nonnegative().nullable(),
  holders: z.number().int().nonnegative().nullable(),
  creatorHoldingPercent: z.number().min(0).max(100).nullable(),
  topHolderConcentrationPercent: z.number().min(0).max(100).nullable(),
  bondingCurveStatus: BondingCurveStatusSchema,
  graduationStatus: GraduationStatusSchema,
  observedAt: z.string().datetime(),
});
export type TokenSnapshot = z.infer<typeof TokenSnapshotSchema>;
