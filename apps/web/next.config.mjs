/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Workspace TS packages (@pump-scalper/solana etc.) use NodeNext-style
    // relative imports ending in .js that point at .ts source files — the
    // standard TS pattern for ESM, understood natively by tsx/Node/tsc but
    // not by webpack's default resolver. Map .js -> .ts/.tsx so importing
    // their runtime code (not just types) bundles correctly.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
