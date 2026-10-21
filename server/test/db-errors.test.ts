import { describe, expect, it } from 'vitest';

import { constraintOf, isForeignKeyViolation, isUniqueViolation, sqlStateOf } from '@/db/errors';

/** Mirrors what Drizzle actually throws: a wrapper whose `cause` is the pg DatabaseError.
 * Verified against a real Postgres before this helper was written. */
function drizzleWrapped(code: string, constraint?: string) {
  const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code,
    constraint,
  });
  return Object.assign(new Error('Failed query'), { cause: driverError });
}

describe('sqlstate extraction', () => {
  it('finds the code on a wrapped driver error', () => {
    expect(sqlStateOf(drizzleWrapped('23505'))).toBe('23505');
  });

  it('finds the code on a bare driver error', () => {
    expect(sqlStateOf(Object.assign(new Error('x'), { code: '23503' }))).toBe('23503');
  });

  it('survives a deeper wrapping chain', () => {
    const nested = Object.assign(new Error('outer'), { cause: drizzleWrapped('23505') });
    expect(sqlStateOf(nested)).toBe('23505');
  });

  it('returns null rather than throwing for unhelpful inputs', () => {
    for (const input of [null, undefined, 'a string', 42, new Error('plain')]) {
      expect(sqlStateOf(input)).toBeNull();
    }
  });

  it('ignores a non-sqlstate code, such as a Node errno', () => {
    expect(sqlStateOf(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBeNull();
  });

  it('stops walking instead of looping on a self-referential cause', () => {
    const circular: any = new Error('loop');
    circular.cause = circular;
    expect(sqlStateOf(circular)).toBeNull();
  });
});

describe('violation classification', () => {
  it('recognises a unique violation', () => {
    expect(isUniqueViolation(drizzleWrapped('23505'))).toBe(true);
    expect(isUniqueViolation(drizzleWrapped('23503'))).toBe(false);
  });

  it('can require a specific constraint, so one table’s indexes do not blur together', () => {
    const error = drizzleWrapped('23505', 'users_email_lower_key');
    expect(isUniqueViolation(error, 'users_email_lower_key')).toBe(true);
    expect(isUniqueViolation(error, 'device_tokens_hash_key')).toBe(false);
  });

  it('recognises a foreign key violation', () => {
    expect(isForeignKeyViolation(drizzleWrapped('23503'))).toBe(true);
    expect(isForeignKeyViolation(drizzleWrapped('23505'))).toBe(false);
  });

  it('reports which constraint failed', () => {
    expect(constraintOf(drizzleWrapped('23505', 'users_email_lower_key'))).toBe('users_email_lower_key');
    expect(constraintOf(drizzleWrapped('23505'))).toBeNull();
  });
});
