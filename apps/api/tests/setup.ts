// Runs before every test file. Sets a self-contained test environment so
// `npm test` never depends on a developer's local .env — and, critically,
// points DATABASE_URL at a dedicated *_test database, never the dev one.
process.env.DATABASE_URL ??= 'postgres://pump_scalper:pump_scalper@localhost:5432/pump_scalper_test';
process.env.SOLANA_RPC_URL ??= 'https://api.mainnet-beta.solana.com';
process.env.SOLANA_WS_URL ??= 'wss://api.mainnet-beta.solana.com';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test_secret_test_secret_test_secret_test_secret';
process.env.ENABLE_LIVE_TRADING ??= 'false';
process.env.NODE_ENV = 'test';
