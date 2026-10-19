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
    /**
     * Integration test files share one Postgres and each truncates between cases, so
     * running them in parallel lets one file delete another's fixtures mid-request and
     * produce spurious 401s. Serialising files is the cheap fix; the alternative is a
     * schema per worker, which is not worth the complexity at this size.
     */
    fileParallelism: false,
  },
});
