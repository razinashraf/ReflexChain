/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The protocol package is shipped as raw TypeScript and shared verbatim with
  // the validator and coordinator processes, so the browser runs the exact same
  // hashing, signing and validation code the network runs.
  transpilePackages: ['@reflexchain/protocol'],
  webpack: (config) => {
    // The protocol sources use ESM-style ".js" specifiers that resolve to ".ts".
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
