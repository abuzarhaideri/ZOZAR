import { describe, expect, it } from 'vitest';
import pg from 'pg';

import { __test } from '@/db/client.js';

/**
 * Regression tests for the TLS configuration of the database connection.
 *
 * These exist because a bug here was invisible to every other test in this suite: the
 * integration tests connect with `sslmode=disable` to a local container, which takes a
 * different branch entirely. Against Aiven the first query failed with
 * SELF_SIGNED_CERT_IN_CHAIN, because `pg` merges the parsed connection string *over* the
 * caller's config and `pg-connection-string` emits `ssl: {}` for `sslmode=require`,
 * silently discarding the CA while leaving TLS switched on.
 *
 * Nothing here opens a socket. `new pg.Client(...)` resolves its configuration in the
 * constructor, so the merged result can be inspected directly.
 */

const CA = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
const AIVEN = 'postgres://avnadmin:pw@zozar.a.aivencloud.com:15975/defaultdb';

function resolvedSsl(connectionString: string) {
  const client = new pg.Client({ connectionString, ssl: { ca: CA, rejectUnauthorized: true } });
  return (client as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;
}

describe('database TLS options', () => {
  it('keeps the CA once sslmode has been stripped', () => {
    expect(resolvedSsl(__test.withoutSslmode(`${AIVEN}?sslmode=require`))).toMatchObject({
      ca: CA,
      rejectUnauthorized: true,
    });
  });

  it('shows why the stripping is needed: sslmode in the URL discards the CA', () => {
    // Guards the reason the fix exists. Should a future pg stop overriding the caller's
    // options, this fails and the workaround can be reconsidered rather than inherited.
    expect(resolvedSsl(`${AIVEN}?sslmode=require`)).not.toMatchObject({ ca: CA });
  });

  it('removes sslmode in any position and keeps other parameters', () => {
    expect(__test.withoutSslmode(`${AIVEN}?sslmode=require`)).toBe(AIVEN);
    expect(__test.withoutSslmode(`${AIVEN}?sslmode=require&application_name=zozar`)).toBe(
      `${AIVEN}?application_name=zozar`,
    );
    expect(__test.withoutSslmode(`${AIVEN}?application_name=zozar&sslmode=verify-full`)).toBe(
      `${AIVEN}?application_name=zozar`,
    );
    expect(__test.withoutSslmode(AIVEN)).toBe(AIVEN);
  });

  it('leaves a password containing reserved characters untouched', () => {
    // `new URL()` would percent-decode this and change the credential, which is why the
    // implementation splits on the query string instead.
    expect(__test.withoutSslmode('postgres://avnadmin:a%2Fb+c@host:5432/db?sslmode=require')).toBe(
      'postgres://avnadmin:a%2Fb+c@host:5432/db',
    );
  });
});
