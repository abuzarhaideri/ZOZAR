import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';
import { sha256Hex } from '@/lib/hash';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('device token and profile routes', () => {
  const app = createApp();

  async function request(path: string, init: RequestInit & { token?: string } = {}) {
    const { token, ...rest } = init;
    const response = await app.request(path, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  async function signUp(email: string) {
    const { body } = await request('/auth/sign-up', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'a-sufficiently-long-password',
        displayName: email.split('@')[0],
        timezone: 'Asia/Kolkata',
      }),
    });
    return body.accessToken as string;
  }

  let token = '';
  let otherToken = '';
  // Long enough that indexing it raw would exceed Postgres's btree key limit, which is
  // why uniqueness is on the hash.
  const FCM_TOKEN = `fcm-${'x'.repeat(3000)}`;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
    token = await signUp('owner@example.com');
    otherToken = await signUp('other@example.com');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const register = (withToken: string, body: Record<string, unknown>) =>
    request('/v1/device-tokens', { method: 'POST', token: withToken, body: JSON.stringify(body) });

  describe('device tokens', () => {
    it('registers a token and returns only its hash, never the token', async () => {
      const response = await register(token, { token: FCM_TOKEN, platform: 'android' });
      expect(response.status).toBe(201);
      expect(response.body.deviceToken.tokenHash).toBe(sha256Hex(FCM_TOKEN));
      expect(JSON.stringify(response.body)).not.toContain(FCM_TOKEN);
    });

    it('accepts a token far longer than a btree key, via the hash index', async () => {
      expect((await register(token, { token: FCM_TOKEN })).status).toBe(201);
    });

    it('is idempotent: re-registering updates rather than duplicating', async () => {
      await register(token, { token: FCM_TOKEN });
      await register(token, { token: FCM_TOKEN, deviceName: 'Pixel 9' });
      const rows = await getDatabase().select().from(schema.deviceTokens);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.deviceName).toBe('Pixel 9');
    });

    it('reassigns a token when a different account registers the same device', async () => {
      // FCM issues one token per install, so the same token under a new account means the
      // device changed hands. Pushes must follow the current owner.
      await register(token, { token: FCM_TOKEN });
      await register(otherToken, { token: FCM_TOKEN });

      const rows = await getDatabase().select().from(schema.deviceTokens);
      expect(rows).toHaveLength(1);

      const [other] = await getDatabase()
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, 'other@example.com'));
      expect(rows[0]?.userId).toBe(other?.id);
    });

    it('deactivates by token rather than deleting', async () => {
      await register(token, { token: FCM_TOKEN });
      const response = await request('/v1/device-tokens', {
        method: 'DELETE',
        token,
        body: JSON.stringify({ token: FCM_TOKEN }),
      });
      expect(response.status).toBe(204);

      const rows = await getDatabase().select().from(schema.deviceTokens);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.isActive).toBe(false);
    });

    it('does not let one account deactivate another’s device', async () => {
      await register(token, { token: FCM_TOKEN });
      await request('/v1/device-tokens', {
        method: 'DELETE',
        token: otherToken,
        body: JSON.stringify({ token: FCM_TOKEN }),
      });
      const rows = await getDatabase().select().from(schema.deviceTokens);
      // Still active: the other account's unregister must not touch it.
      expect(rows[0]?.isActive).toBe(true);
    });

    it('reports 204 for an unknown token without disclosing whether it existed', async () => {
      const response = await request('/v1/device-tokens', {
        method: 'DELETE',
        token,
        body: JSON.stringify({ token: 'never-registered' }),
      });
      expect(response.status).toBe(204);
    });

    it('rejects an empty token and an unknown platform', async () => {
      expect((await register(token, { token: '' })).status).toBe(400);
      expect((await register(token, { token: FCM_TOKEN, platform: 'blackberry' })).status).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await request('/v1/device-tokens', { method: 'POST', body: JSON.stringify({ token: 'x' }) })).status).toBe(401);
    });
  });

  describe('profile', () => {
    it('returns your own profile', async () => {
      const { status, body } = await request('/v1/profile', { token });
      expect(status).toBe(200);
      expect(body.profile).toMatchObject({
        email: 'owner@example.com',
        displayName: 'owner',
        timezone: 'Asia/Kolkata',
      });
    });

    it('never exposes the password hash or claim token', async () => {
      const { body } = await request('/v1/profile', { token });
      const keys = Object.keys(body.profile);
      expect(keys).not.toContain('passwordHash');
      expect(keys).not.toContain('claimTokenHash');
      expect(keys).not.toContain('passwordResetRequired');
    });

    it('updates display name and timezone', async () => {
      const response = await request('/v1/profile', {
        method: 'PATCH',
        token,
        body: JSON.stringify({ displayName: 'Renamed', timezone: 'Europe/London' }),
      });
      expect(response.body.profile).toMatchObject({ displayName: 'Renamed', timezone: 'Europe/London' });
    });

    it('rejects an unknown timezone, which would break alarm scheduling', async () => {
      const response = await request('/v1/profile', {
        method: 'PATCH',
        token,
        body: JSON.stringify({ timezone: 'Mars/Olympus' }),
      });
      expect(response.status).toBe(400);
    });

    it('ignores an attempt to change email', async () => {
      // Email is the account identity and pending invites are addressed to it, so it is
      // not updatable without a verification step this API does not have.
      const response = await request('/v1/profile', {
        method: 'PATCH',
        token,
        body: JSON.stringify({ email: 'hijack@example.com', displayName: 'Still Me' }),
      });
      expect(response.status).toBe(200);
      expect(response.body.profile.email).toBe('owner@example.com');
    });

    it('rejects an empty patch and a blank display name', async () => {
      expect((await request('/v1/profile', { method: 'PATCH', token, body: JSON.stringify({}) })).status).toBe(400);
      expect(
        (await request('/v1/profile', { method: 'PATCH', token, body: JSON.stringify({ displayName: '  ' }) })).status,
      ).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await request('/v1/profile')).status).toBe(401);
    });
  });
});
