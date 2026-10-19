import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // scrypt at a real work factor takes ~100ms per hash, so password tests need more
    // than the 5s default once a few hashes run in one case.
    testTimeout: 20_000,
  },
});
