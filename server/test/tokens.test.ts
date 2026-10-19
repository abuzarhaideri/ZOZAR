import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  bearerFromHeader,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  resetSigningKeyCache,
  signAccessToken,
  verifyAccessToken,
} from '@/auth/tokens';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  resetSigningKeyCache();
});

describe('access tokens', () => {
  it('round-trips the session claims', async () => {
    const token = await signAccessToken({ userId: 'user-1', email: 'a@example.com' });
    await expect(verifyAccessToken(token)).resolves.toEqual({ userId: 'user-1', email: 'a@example.com' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken({ userId: 'user-1', email: 'a@example.com' });
    process.env.JWT_SECRET = OTHER_SECRET;
    resetSigningKeyCache();
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signAccessToken({ userId: 'user-1', email: 'a@example.com' });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'user-2', email: 'b@example.com' })).toString('base64url');
    await expect(verifyAccessToken(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects structurally invalid tokens without throwing', async () => {
    for (const invalid of ['', 'not-a-jwt', 'a.b', 'a.b.c']) {
      await expect(verifyAccessToken(invalid)).resolves.toBeNull();
    }
  });

  it('refuses a secret shorter than the HS256 output', async () => {
    process.env.JWT_SECRET = 'too-short';
    resetSigningKeyCache();
    await expect(signAccessToken({ userId: 'u', email: 'e' })).rejects.toThrow(/at least 32 bytes/);
  });

  it('expires in fifteen minutes', () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });
});

describe('refresh tokens', () => {
  it('stores only a hash, never the token', () => {
    const { token, tokenHash } = createRefreshToken();
    expect(tokenHash).toBe(hashRefreshToken(token));
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues a distinct token every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createRefreshToken().token));
    expect(tokens.size).toBe(50);
  });

  it('is long enough to be unguessable', () => {
    // 32 random bytes, base64url encoded, so 43 characters with no padding.
    expect(createRefreshToken().token).toHaveLength(43);
  });

  it('expires sixty days out', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(refreshTokenExpiry(now).toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });
});

describe('bearer header parsing', () => {
  it('extracts the token and tolerates scheme casing', () => {
    expect(bearerFromHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerFromHeader('bearer abc')).toBe('abc');
    expect(bearerFromHeader('BEARER   abc')).toBe('abc');
  });

  it('returns null for anything that is not a bearer credential', () => {
    for (const header of [null, undefined, '', 'Basic abc', 'Bearer', 'Bearer    ']) {
      expect(bearerFromHeader(header)).toBeNull();
    }
  });
});
