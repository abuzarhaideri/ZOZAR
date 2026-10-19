import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('commitment routes', () => {
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

  const validBody = { title: 'Ship the migration', startsAt: '2026-11-01T06:30:00.000Z' };

  async function create(withToken = token, overrides: Record<string, unknown> = {}) {
    return request('/v1/commitments', {
      method: 'POST',
      token: withToken,
      body: JSON.stringify({ ...validBody, ...overrides }),
    });
  }

  it('creates a commitment and lists it', async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(created.body.commitment).toMatchObject({ title: 'Ship the migration', status: 'planned' });

    const listed = await request('/v1/commitments', { token });
    expect(listed.body.commitments).toHaveLength(1);
  });

  it('requires authentication', async () => {
    // Passing no token at all, rather than create()'s default, which would authenticate.
    expect((await request('/v1/commitments')).status).toBe(401);
    expect(
      (await request('/v1/commitments', { method: 'POST', body: JSON.stringify(validBody) })).status,
    ).toBe(401);
    expect(
      (await request('/v1/commitments/8f14e45f-ceea-4e34-a9f1-1b0b1b0b1b0b', { method: 'DELETE' })).status,
    ).toBe(401);
  });

  it('rejects an empty title and a missing start', async () => {
    expect((await create(token, { title: '   ' })).status).toBe(400);
    expect((await create(token, { startsAt: undefined })).status).toBe(400);
    expect((await create(token, { startsAt: 'not-a-date' })).status).toBe(400);
  });

  it('rejects an end before the start', async () => {
    const response = await create(token, { endsAt: '2026-10-01T00:00:00.000Z' });
    expect(response.status).toBe(400);
  });

  describe('isolation between users', () => {
    it('does not list another user’s commitments', async () => {
      await create(token);
      const listed = await request('/v1/commitments', { token: otherToken });
      expect(listed.body.commitments).toHaveLength(0);
    });

    it('reports another user’s commitment as 404, not 403', async () => {
      // 403 would confirm the row exists. Appwrite enforced this with row permissions;
      // now it is authz.ts, so it needs a test at the HTTP boundary.
      const { body } = await create(token);
      const id = body.commitment.id;

      for (const [method, init] of [
        ['GET', {}],
        ['PATCH', { body: JSON.stringify({ title: 'hijacked' }) }],
        ['DELETE', {}],
      ] as const) {
        const response = await request(`/v1/commitments/${id}`, {
          method,
          token: otherToken,
          ...init,
        });
        expect(response.status, `${method} should be 404`).toBe(404);
      }

      const complete = await request(`/v1/commitments/${id}/complete`, {
        method: 'POST',
        token: otherToken,
        body: JSON.stringify({ complete: true }),
      });
      expect(complete.status).toBe(404);
    });

    it('leaves the row untouched after a rejected write', async () => {
      const { body } = await create(token);
      await request(`/v1/commitments/${body.commitment.id}`, {
        method: 'PATCH',
        token: otherToken,
        body: JSON.stringify({ title: 'hijacked' }),
      });
      const after = await request(`/v1/commitments/${body.commitment.id}`, { token });
      expect(after.body.commitment.title).toBe('Ship the migration');
    });
  });

  it('treats a malformed id as 404 rather than erroring on invalid uuid syntax', async () => {
    // Postgres rejects bad uuid syntax with 22P02, which would otherwise surface as a 500.
    const response = await request('/v1/commitments/not-a-uuid', { token });
    expect(response.status).toBe(404);
  });

  it('treats an unknown but well-formed id as 404', async () => {
    const response = await request('/v1/commitments/8f14e45f-ceea-4e34-a9f1-1b0b1b0b1b0b', { token });
    expect(response.status).toBe(404);
  });

  describe('updating', () => {
    it('applies a partial update', async () => {
      const { body } = await create();
      const updated = await request(`/v1/commitments/${body.commitment.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ title: 'Renamed' }),
      });
      expect(updated.status).toBe(200);
      expect(updated.body.commitment).toMatchObject({ title: 'Renamed', status: 'planned' });
    });

    it('rejects an empty patch instead of silently succeeding', async () => {
      const { body } = await create();
      const response = await request(`/v1/commitments/${body.commitment.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });

    it('derives completedAt from status rather than trusting the client', async () => {
      const { body } = await create();
      const completed = await request(`/v1/commitments/${body.commitment.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status: 'completed' }),
      });
      expect(completed.body.commitment.completedAt).toBeTruthy();

      const reopened = await request(`/v1/commitments/${body.commitment.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ status: 'planned' }),
      });
      expect(reopened.body.commitment.completedAt).toBeNull();
    });
  });

  describe('completing', () => {
    it('toggles completion both ways', async () => {
      const { body } = await create();
      const id = body.commitment.id;

      const done = await request(`/v1/commitments/${id}/complete`, {
        method: 'POST',
        token,
        body: JSON.stringify({ complete: true }),
      });
      expect(done.body.commitment).toMatchObject({ status: 'completed' });
      expect(done.body.commitment.completedAt).toBeTruthy();

      const undone = await request(`/v1/commitments/${id}/complete`, {
        method: 'POST',
        token,
        body: JSON.stringify({ complete: false }),
      });
      expect(undone.body.commitment).toMatchObject({ status: 'planned', completedAt: null });
    });

    it('requires an explicit boolean', async () => {
      const { body } = await create();
      const response = await request(`/v1/commitments/${body.commitment.id}/complete`, {
        method: 'POST',
        token,
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });
  });

  it('deletes a commitment', async () => {
    const { body } = await create();
    expect((await request(`/v1/commitments/${body.commitment.id}`, { method: 'DELETE', token })).status).toBe(204);
    expect((await request('/v1/commitments', { token })).body.commitments).toHaveLength(0);
  });

  it('orders the list by start time', async () => {
    await create(token, { title: 'Later', startsAt: '2026-12-01T06:00:00.000Z' });
    await create(token, { title: 'Sooner', startsAt: '2026-11-01T06:00:00.000Z' });
    const listed = await request('/v1/commitments', { token });
    expect(listed.body.commitments.map((row: any) => row.title)).toEqual(['Sooner', 'Later']);
  });
});
