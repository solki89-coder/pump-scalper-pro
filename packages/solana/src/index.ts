// Browser-safe entry point — usable from apps/web as well as apps/api.
// EventEmitter-based, Node-only pieces (RpcHealthMonitor, the pump.fun
// on-chain discovery adapter) live in ./server.ts instead: pulling them
// into a frontend bundle drags in `node:events`, which webpack won't
// polyfill by default and which those classes have no business running in
// a browser anyway. See server.ts for the split's other half.
export * from './connection.js';
export * from './lamports.js';
export * from './walletAdapter.js';
export * from './walletReader.js';
export * from './adapters/dexscreener.js';
