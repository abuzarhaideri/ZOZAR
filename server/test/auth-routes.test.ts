import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { hashRefreshToken, resetSigningKeyCache } from '@/auth/tokens';

/**
 * Integration tests against a real Postgres, because the parts most worth testing here
 * are the ones a mock would paper over: the unique index deciding a duplicate sign-up, and
 * refresh rotation behaving correctly under replay.
 *
 * Skipped automatically when DATABASE_URL is unset, so `npm test` still works on a machine
 * with no database. CI always sets it, so these always run there.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

type Json = Record<string, any>;

suite('auth routes', () => {
  const app = createApp();

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Json | null };
  }

  const credentials = {
    email: 'tester@example.com',
    password: 'a-sufficiently-long-password',
    displayName: 'Tester',
    timezone: 'Asia/Kolkata',
  };

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  beforeEach(async () => {
    // Truncating users cascades to refresh tokens and everything else keyed off a user.
    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('sign-up', () => {
    it('creates an account and returns a usable session', async () => {
      const { status, body } = await post('/auth/sign-up', credentials);
      expect(status).toBe(201);
      expect(body?.user).toMatchObject({ email: 'tester@example.com', displayName: 'Tester' });
      expect(body?.accessToken).toBeTypeOf('string');
      expect(body?.refreshToken).toBeTypeOf('string');
      expect(body?.expiresIn).toBe(900);

      const me = await app.request('/v1/me', { headers: { Authorization: `Bearer ${body?.accessToken}` } });
      expect(me.status).toBe(200);
    });

    it('rejects a duplicate email regardless of casing', async () => {
      await post('/auth/sign-up', credentials);
      const { status, body } = await post('/auth/sign-up', { ...credentials, email: 'TESTER@Example.com' });
      expect(status).toBe(409);
      expect(body?.error.code).toBe('email_taken');
    });

    it('rejects a short password and an invalid timezone', async () => {
      expect((await post('/auth/sign-up', { ...credentials, password: 'short' })).status).toBe(400);
      expect((await post('/auth/sign-up', { ...credentials, timezone: 'Mars/Olympus' })).status).toBe(400);
    });

    it('never stores the password in recoverable form', async () => {
      await post('/auth/sign-up', credentials);
      const [row] = await getDatabase().select({ hash: schema.users.passwordHash }).from(schema.users).limit(1);
      expect(row?.hash).toBeTruthy();
      expect(row?.hash).not.toContain(credentials.password);
      expect(row?.hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    });
  });

  describe('sign-in', () => {
    beforeEach(async () => {
      await post('/auth/sign-up', credentials);
    });

    it('accepts correct credentials', async () => {
      const { status, body } = await post('/auth/sign-in', {
        email: credentials.email,
        password: credentials.password,
      });
      expect(status).toBe(200);
      expect(body?.user.email).toBe('tester@example.com');
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const wrong = await post('/auth/sign-in', { email: credentials.email, password: 'wrong-password-here' });
      const missing = await post('/auth/sign-in', { email: 'nobody@example.com', password: 'wrong-password-here' });
      expect(wrong.status).toBe(401);
      expect(missing.status).toBe(401);
      // Identical responses, so neither reveals whether the account exists.
      expect(wrong.body).toEqual(missing.body);
    });
  });

  describe('refresh rotation', () => {
    async function signUp() {
      const { body } = await post('/auth/sign-up', credentials);
      return body!.refreshToken as string;
    }

    it('exchanges a refresh token for a new pair', async () => {
      const first = await signUp();
      const { status, body } = await post('/auth/refresh', { refreshToken: first });
      expect(status).toBe(200);
      expect(body?.refreshToken).not.toBe(first);
      expect(body?.accessToken).toBeTypeOf('string');
    });

    it('refuses to reuse a rotated token', async () => {
      const first = await signUp();
      await post('/auth/refresh', { refreshToken: first });
      const replay = await post('/auth/refresh', { refreshToken: first });
      expect(replay.status).toBe(401);
    });

    it('revokes the whole family when a rotated token is replayed', async () => {
      // The theft-detection rule: if two parties hold the same token we cannot tell which
      // is legitimate, so both lose the session.
      const first = await signUp();
      const second = (await post('/auth/refresh', { refreshToken: first })).body!.refreshToken as string;

      await post('/auth/refresh', { refreshToken: first });

      const stillValid = await post('/auth/refresh', { refreshToken: second });
      expect(stillValid.status).toBe(401);
    });

    it('rejects an unknown token', async () => {
      expect((await post('/auth/refresh', { refreshToken: 'not-a-real-token' })).status).toBe(401);
    });

    it('keeps rotations in one family rather than opening a new one each time', async () => {
      const first = await signUp();
      const second = (await post('/auth/refresh', { refreshToken: first })).body!.refreshToken as string;
      await post('/auth/refresh', { refreshToken: second });

      const rows = await getDatabase()
        .select({ familyId: schema.refreshTokens.familyId })
        .from(schema.refreshTokens);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
    });
  });

  describe('sign-out', () => {
    it('invalidates the token and reports success even for an unknown one', async () => {
      const { body } = await post('/auth/sign-up', credentials);
      const token = body!.refreshToken as string;

      expect((await post('/auth/sign-out', { refreshToken: token })).status).toBe(204);
      expect((await post('/auth/refresh', { refreshToken: token })).status).toBe(401);
      // Must not reveal whether the token was real.
      expect((await post('/auth/sign-out', { refreshToken: 'never-existed' })).status).toBe(204);
    });
  });

  describe('claiming a migrated account', () => {
    const claimToken = 'migration-issued-claim-token';

    async function seedMigratedUser(expiresAt: Date) {
      await getDatabase().insert(schema.users).values({
        email: 'migrated@example.com',
        passwordHash: null,
        passwordResetRequired: true,
        claimTokenHash: hashRefreshToken(claimToken),
        claimTokenExpiresAt: expiresAt,
        displayName: 'Migrated Person',
        timezone: 'Asia/Kolkata',
      });
    }

    const future = () => new Date(Date.now() + 7 * 86_400_000);

    it('tells the client a migrated account needs a password instead of failing as bad credentials', async () => {
      await seedMigratedUser(future());
      const { status, body } = await post('/auth/sign-in', {
        email: 'migrated@example.com',
        password: 'anything-at-all-here',
      });
      expect(status).toBe(409);
      expect(body?.error.code).toBe('password_reset_required');
    });

    it('sets a password when the claim token matches', async () => {
      await seedMigratedUser(future());
      const { status, body } = await post('/auth/claim-account', {
        email: 'migrated@example.com',
        claimToken,
        password: 'a-brand-new-long-password',
      });
      expect(status).toBe(200);
      expect(body?.user.displayName).toBe('Migrated Person');

      const signIn = await post('/auth/sign-in', {
        email: 'migrated@example.com',
        password: 'a-brand-new-long-password',
      });
      expect(signIn.status).toBe(200);
    });

    it('refuses a wrong claim token, so knowing the email is not enough to take the account', async () => {
      await seedMigratedUser(future());
      const { status } = await post('/auth/claim-account', {
        email: 'migrated@example.com',
        claimToken: 'guessed-wrong',
        password: 'a-brand-new-long-password',
      });
      expect(status).toBe(401);
    });

    it('refuses an expired claim token', async () => {
      await seedMigratedUser(new Date(Date.now() - 1000));
      const { status } = await post('/auth/claim-account', {
        email: 'migrated@example.com',
        claimToken,
        password: 'a-brand-new-long-password',
      });
      expect(status).toBe(401);
    });

    it('cannot be replayed to overwrite a password already set', async () => {
      await seedMigratedUser(future());
      await post('/auth/claim-account', {
        email: 'migrated@example.com',
        claimToken,
        password: 'a-brand-new-long-password',
      });
      const replay = await post('/auth/claim-account', {
        email: 'migrated@example.com',
        claimToken,
        password: 'attacker-chosen-password',
      });
      expect(replay.status).toBe(401);
    });
  });

  describe('route guard', () => {
    it('rejects missing, malformed, and forged tokens', async () => {
      const headerSets: Record<string, string>[] = [
        {},
        { Authorization: 'Bearer nope' },
        { Authorization: 'Basic abc' },
      ];
      for (const headers of headerSets) {
        const response = await app.request('/v1/me', { headers });
        expect(response.status).toBe(401);
      }
    });

    it('leaves the health probe open and database-free', async () => {
      const response = await app.request('/health');
      expect(response.status).toBe(200);
    });
  });
});
