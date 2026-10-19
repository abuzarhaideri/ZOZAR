import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { closeDatabase, getDatabase } from './client.js';

/**
 * Applies the committed SQL migrations. Run from CI against a throwaway Postgres to prove
 * the migrations are valid, and manually against Aiven to release a schema change.
 *
 * This is a one-shot script, not a Lambda. It takes a connection from the same budget as
 * everything else, which is why the architecture notes reserve headroom for it: running a
 * migration while the API is saturated would otherwise fail to connect.
 */
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main(): Promise<void> {
  const database = getDatabase();
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(database, { migrationsFolder });
  console.log('[migrate] up to date');
}

main()
  .catch((error) => {
    console.error('[migrate] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
