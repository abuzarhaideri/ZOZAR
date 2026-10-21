import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { closeDatabase, getDatabase } from '../src/db/client.js';

/**
 * Brings the test database's schema up to date before any test file runs.
 *
 * The integration tests truncate tables between cases, which assumes the tables exist.
 * Nothing created them: locally the migrations had been run by hand beforehand, so the
 * suite passed, while CI ran the tests before its migration step and 177 of 291 failed
 * with `relation "users" does not exist`. A suite that only passes after an undocumented
 * manual step is not a suite anyone else can run, so it now prepares its own schema.
 *
 * Migrations are idempotent, so on a database that is already current this is a no-op.
 * CI still applies them to an empty database first as a separate step, which is what
 * proves they are valid; this setup only guarantees the tests never start without them.
 */
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations');

export async function setup(): Promise<void> {
  try {
    await migrate(getDatabase(), { migrationsFolder });
  } finally {
    // This runs in Vitest's main process, separate from the test workers, so the pool
    // closed here is not one any test is using.
    await closeDatabase();
  }
}
