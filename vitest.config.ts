import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@reflexchain/protocol': fileURLToPath(
        new URL('./packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
