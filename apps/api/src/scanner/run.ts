/**
 * Manual smoke-test entrypoint — NOT wired into the (not-yet-existing)
 * Fastify server. Run with:
 *   npx tsx src/scanner/run.ts
 * Requires a working SOLANA_RPC_URL/SOLANA_WS_URL in .env and a reachable
 * Postgres (npm run migrate first). Logs every discovered mint and every
 * enrichment update to stdout; stop with Ctrl+C.
 */
import { createTokenScanner } from './index.js';

const scanner = createTokenScanner();
scanner.start();
console.log('Token scanner running. Watching for new pump.fun launches...');

process.on('SIGINT', () => {
  void scanner.stop().then(() => process.exit(0));
});
