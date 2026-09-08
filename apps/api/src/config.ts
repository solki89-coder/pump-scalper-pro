import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve .env from the repo root regardless of the process's cwd (npm
// workspace scripts run with cwd = the package directory, not the root).
const repoRootEnv = resolve(__dirname, '../../../.env');
if (existsSync(repoRootEnv)) {
  loadDotenv({ path: repoRootEnv });
} else {
  loadDotenv();
}

const boolFromString = z
  .string()
  .default('false')
  .transform((v) => v.trim().toLowerCase() === 'true');

const numFromString = (def: number) =>
  z
    .string()
    .default(String(def))
    .transform((v) => Number(v))
    .pipe(z.number().finite());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: numFromString(4000),
  LOG_LEVEL: z.string().default('info'),

  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url(),
  DEXSCREENER_API_BASE: z.string().url().default('https://api.dexscreener.com'),
  // Jupiter's aggregator routes pump.fun (bonding-curve and post-graduation
  // PumpSwap/Raydium) trades, confirmed via their own integration
  // announcements — used as the live swap backend instead of hand-rolling
  // pump.fun's own (unverified) instruction format. Base URL is
  // configurable because Jupiter has changed it before (quote-api.jup.ag ->
  // lite-api.jup.ag); verify against https://dev.jup.ag before going live.
  JUPITER_API_BASE: z.string().url().default('https://lite-api.jup.ag/swap/v1'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),

  JWT_SECRET: z.string().min(1),
  ADMIN_EMAIL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),

  ENABLE_LIVE_TRADING: boolFromString,

  TRADING_ALLOCATION_SOL: numFromString(0),
  MAX_POSITION_SIZE_SOL: numFromString(0),
  MAX_DAILY_LOSS_SOL: numFromString(0),
  MAX_TOTAL_EXPOSURE_SOL: numFromString(0),
  MAX_OPEN_POSITIONS: numFromString(0),
  MAX_TRADES_PER_DAY: numFromString(0),
  MAX_SLIPPAGE_BPS: numFromString(0),
  MIN_SOL_BALANCE: numFromString(0),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | undefined;

/**
 * Parses and validates process.env once (memoized). Throws with a precise
 * message on first use if required config is missing — fail fast at boot,
 * never at trade time.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/** Test-only: clear the memoized config so a fresh env can be loaded. */
export function _resetConfigCacheForTests(): void {
  cached = undefined;
}
