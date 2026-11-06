import type { ConnectionOptions } from 'node:tls';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let database: Database | undefined;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Aiven signs database certificates with a per-project CA rather than a public one, so
 * Node's default trust store cannot verify them. The CA is supplied base64-encoded via
 * DATABASE_CA_CERT and TLS is verified against it.
 *
 * `sslmode=disable` in the URL turns TLS off entirely. That exists for the throwaway
 * Postgres containers used by CI and local development, which serve no certificate at
 * all; attempting TLS against them fails the connection outright. Aiven always requires
 * TLS, so this flag never appears in a deployed configuration.
 *
 * When TLS is on but no CA is supplied the peer cannot be verified, which leaves the
 * connection open to an active man-in-the-middle. That is tolerable on a developer
 * machine and not in production, so production refuses to start without the CA.
 */
function tlsOptions(): ConnectionOptions | false {
  const url = process.env.DATABASE_URL ?? '';
  const isProduction = process.env.NODE_ENV === 'production';

  if (/[?&]sslmode=disable\b/.test(url)) {
    if (isProduction) {
      throw new Error('sslmode=disable is not permitted in production; Aiven requires TLS.');
    }
    return false;
  }

  const encoded = process.env.DATABASE_CA_CERT?.trim();
  if (encoded) {
    return { ca: Buffer.from(encoded, 'base64').toString('utf8'), rejectUnauthorized: true };
  }
  if (isProduction) {
    throw new Error('DATABASE_CA_CERT is required in production so the Aiven certificate can be verified.');
  }
  return { rejectUnauthorized: false };
}

/**
 * Removes `sslmode` from the connection string.
 *
 * `pg` builds its effective config as `Object.assign({}, config, parse(connectionString))`
 * — the parsed URL wins over what the caller passed. `pg-connection-string` returns
 * `ssl: {}` for `sslmode=require`, so that empty object **replaces** the options from
 * `tlsOptions()`, discarding Aiven's CA. TLS stays on, nothing can verify the peer, and
 * every query dies with SELF_SIGNED_CERT_IN_CHAIN.
 *
 * Stripping the parameter leaves no `ssl` key in the parsed result, so the explicit
 * options survive the merge and remain the single source of truth. This is stricter than
 * `sslmode=require`, not looser: the connection still demands TLS and now actually
 * verifies the certificate against the project CA.
 *
 * Done by splitting on the query string rather than with `new URL()`, which percent-
 * decodes and re-encodes the password and can therefore change it.
 */
function withoutSslmode(url: string): string {
  const queryAt = url.indexOf('?');
  if (queryAt === -1) return url;
  const base = url.slice(0, queryAt);
  const params = url
    .slice(queryAt + 1)
    .split('&')
    .filter((param) => !/^sslmode=/i.test(param));
  return params.length > 0 ? `${base}?${params.join('&')}` : base;
}

/**
 * The connection budget, re-derived for Catalyst AppSail.
 *
 * Aiven's free PostgreSQL plan allows 20 connections and offers no PgBouncer, so the
 * ceiling is hard and shared by everything that talks to the database.
 *
 * On Lambda this was `max: 1`: each container served one request at a time, so a second
 * connection could never be used, and reserved concurrency capped the number of
 * containers. AppSail is the opposite shape — a long-lived Node process serving up to 100
 * concurrent requests, scaling out to at most 5 instances. Keeping `max: 1` there would
 * not save connections, it would serialise every concurrent request behind a single
 * socket and turn the pool into the bottleneck.
 *
 * So the budget is spent the other way round: 5 instances x 3 connections = 15, leaving 5
 * of Aiven's 20 for migrations, a psql session and Aiven's own management. DB_POOL_MAX
 * exists so this can be lowered without a deploy if the ceiling is ever hit.
 */
const DEFAULT_POOL_MAX = 3;

function poolMax(): number {
  const configured = Number(process.env.DB_POOL_MAX);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_POOL_MAX;
}
export function getDatabase(): Database {
  if (database) return database;

  pool = new pg.Pool({
    connectionString: withoutSslmode(requireEnv('DATABASE_URL')),
    ssl: tlsOptions(),
    max: poolMax(),
    // AppSail instances are long-lived and idle between bursts, so this now does real
    // work: connections are handed back to Aiven during quiet periods instead of being
    // held for the life of the instance.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    // Aiven drops idle TCP sessions; keepalives stop a reused container from inheriting a
    // half-open socket and failing its first query.
    keepAlive: true,
    allowExitOnIdle: false,
  });

  pool.on('error', (error) => {
    // An idle client erroring must not take the container down; the next checkout
    // reconnects. Logging keeps it visible in the Catalyst logs.
    console.error('[db] idle client error', error);
  });

  database = drizzle(pool, { schema });
  return database;
}

/** Only for the migrator, tests, and local scripts. The AppSail process must never call this:
 * closing the pool would discard the connection the next invocation expects to reuse. */
export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
  database = undefined;
}

export { schema };

/** Exposed for tests only; see server/test/db-tls.test.ts. */
export const __test = { withoutSslmode };
