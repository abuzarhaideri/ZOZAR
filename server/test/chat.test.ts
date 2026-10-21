import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('chat routes', () => {
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

  let asha = '';
  let ravi = '';
  let nosy = '';
  let threadId = '';

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  /** A thread only exists once two people are connected, so every case starts from an
   * accepted invitation rather than inserting a thread directly. */
  beforeEach(async () => {
    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
    asha = await signUp('asha@example.com');
    ravi = await signUp('ravi@example.com');
    nosy = await signUp('nosy@example.com');

    const invited = await request('/v1/connections', {
      method: 'POST',
      token: asha,
      body: JSON.stringify({ email: 'ravi@example.com' }),
    });
    await request(`/v1/connections/${invited.body.connection.id}/respond`, {
      method: 'POST',
      token: ravi,
      body: JSON.stringify({ accept: true }),
    });

    const threads = await request('/v1/chat/threads', { token: asha });
    threadId = threads.body.threads[0].id;
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const send = (token: string, body: string, id = threadId) =>
    request(`/v1/chat/threads/${id}/messages`, { method: 'POST', token, body: JSON.stringify({ body }) });

  describe('threads', () => {
    it('appears for both participants once connected', async () => {
      expect((await request('/v1/chat/threads', { token: asha })).body.threads).toHaveLength(1);
      expect((await request('/v1/chat/threads', { token: ravi })).body.threads).toHaveLength(1);
    });

    it('names the other person, not yourself', async () => {
      const ashaView = await request('/v1/chat/threads', { token: asha });
      expect(ashaView.body.threads[0].other.displayName).toBe('ravi');
      const raviView = await request('/v1/chat/threads', { token: ravi });
      expect(raviView.body.threads[0].other.displayName).toBe('asha');
    });

    it('exposes only display fields of the other person', async () => {
      // Sharing a conversation does not entitle you to their email or timezone.
      const { body } = await request('/v1/chat/threads', { token: asha });
      expect(Object.keys(body.threads[0].other).sort()).toEqual(['displayName', 'id', 'photoKey']);
    });

    it('shows no threads to an unconnected user', async () => {
      expect((await request('/v1/chat/threads', { token: nosy })).body.threads).toHaveLength(0);
    });

    it('defaults to 30 day retention', async () => {
      const { body } = await request(`/v1/chat/threads/${threadId}`, { token: asha });
      expect(body.thread.retention).toBe('30d');
    });
  });

  describe('messages', () => {
    it('sends and reads a message', async () => {
      const sent = await send(asha, 'Are you up?');
      expect(sent.status).toBe(201);
      expect(sent.body.message).toMatchObject({ body: 'Are you up?', type: 'text' });

      const read = await request(`/v1/chat/threads/${threadId}/messages`, { token: ravi });
      expect(read.body.messages).toHaveLength(1);
      expect(read.body.messages[0].body).toBe('Are you up?');
    });

    it('orders messages oldest first', async () => {
      await send(asha, 'first');
      await send(ravi, 'second');
      await send(asha, 'third');
      const { body } = await request(`/v1/chat/threads/${threadId}/messages`, { token: asha });
      expect(body.messages.map((m: any) => m.body)).toEqual(['first', 'second', 'third']);
    });

    it('rejects an empty or whitespace-only message', async () => {
      expect((await send(asha, '')).status).toBe(400);
      expect((await send(asha, '    ')).status).toBe(400);
    });

    it('stamps expiry from the thread retention', async () => {
      const { body } = await send(asha, 'ephemeral');
      const expires = new Date(body.message.expiresAt).getTime();
      const thirtyDays = Date.now() + 30 * 86_400_000;
      // Within a minute of thirty days out.
      expect(Math.abs(expires - thirtyDays)).toBeLessThan(60_000);
    });

    it('hides an expired message on read, without waiting for the sweep', async () => {
      // The promise is "gone after 7 days", so a reader must not see a message past its
      // expiry merely because the worker has not run yet.
      const { body } = await send(asha, 'should vanish');
      await getDatabase()
        .update(schema.messages)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.messages.id, body.message.id));

      const read = await request(`/v1/chat/threads/${threadId}/messages`, { token: asha });
      expect(read.body.messages).toHaveLength(0);
    });
  });

  describe('retention', () => {
    it('lets either participant change it and records who', async () => {
      const updated = await request(`/v1/chat/threads/${threadId}`, {
        method: 'PATCH',
        token: ravi,
        body: JSON.stringify({ retention: '7d' }),
      });
      expect(updated.status).toBe(200);
      expect(updated.body.thread.retention).toBe('7d');
      expect(updated.body.thread.retentionChangedBy).toBeTruthy();
      expect(updated.body.thread.retentionChangedAt).toBeTruthy();
    });

    it('applies to new messages only, so one party cannot erase shared history', async () => {
      const before = await send(asha, 'sent under 30d');
      await request(`/v1/chat/threads/${threadId}`, {
        method: 'PATCH',
        token: ravi,
        body: JSON.stringify({ retention: '7d' }),
      });
      const after = await send(asha, 'sent under 7d');

      const beforeExpiry = new Date(before.body.message.expiresAt).getTime();
      const afterExpiry = new Date(after.body.message.expiresAt).getTime();
      // The earlier message keeps its original, longer life.
      expect(beforeExpiry).toBeGreaterThan(afterExpiry);
    });

    it('rejects an unknown retention value', async () => {
      const response = await request(`/v1/chat/threads/${threadId}`, {
        method: 'PATCH',
        token: asha,
        body: JSON.stringify({ retention: 'forever' }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('isolation', () => {
    it('refuses every thread operation to a non-participant with 404', async () => {
      await send(asha, 'private');

      expect((await request(`/v1/chat/threads/${threadId}`, { token: nosy })).status).toBe(404);
      expect((await request(`/v1/chat/threads/${threadId}/messages`, { token: nosy })).status).toBe(404);
      expect((await send(nosy, 'intruding')).status).toBe(404);
      expect(
        (await request(`/v1/chat/threads/${threadId}`, {
          method: 'PATCH',
          token: nosy,
          body: JSON.stringify({ retention: '7d' }),
        })).status,
      ).toBe(404);
    });

    it('does not let a non-participant write a message', async () => {
      await send(nosy, 'intruding');
      const { body } = await request(`/v1/chat/threads/${threadId}/messages`, { token: asha });
      expect(body.messages).toHaveLength(0);
    });

    it('requires authentication', async () => {
      expect((await request('/v1/chat/threads')).status).toBe(401);
      expect((await request(`/v1/chat/threads/${threadId}/messages`)).status).toBe(401);
    });

    it('treats an unknown thread as 404', async () => {
      expect(
        (await request('/v1/chat/threads/8f14e45f-ceea-4e34-a9f1-1b0b1b0b1b0b', { token: asha })).status,
      ).toBe(404);
      expect((await request('/v1/chat/threads/not-a-uuid', { token: asha })).status).toBe(404);
    });
  });
});
