import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache, signAccessToken } from '@/auth/tokens';
import { setNotifierForTests, type PushMessage, type Notifier } from '@/lib/push';
import { getRealtime, setRealtimeForTests, type Realtime, type RealtimeEvent } from '@/realtime/publish';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('realtime', () => {
  const app = createApp();
  let published: RealtimeEvent[] = [];

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
  let threadId = '';
  let ashaId = '';
  let raviId = '';

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
    resetSigningKeyCache();
  });

  beforeEach(async () => {
    published = [];
    const fake: Realtime = {
      async publishToThread(event) {
        published.push(event);
        return 1;
      },
    };
    setRealtimeForTests(fake);

    await getDatabase().execute(sql`truncate table ${schema.users} cascade`);
    asha = await signUp('asha@example.com');
    ravi = await signUp('ravi@example.com');

    const people = await getDatabase()
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users);
    ashaId = people.find((p) => p.email === 'asha@example.com')!.id;
    raviId = people.find((p) => p.email === 'ravi@example.com')!.id;

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
    threadId = (await request('/v1/chat/threads', { token: asha })).body.threads[0].id;
  });

  afterEach(() => {
    setRealtimeForTests(null);
    setNotifierForTests(null);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('publishing on send', () => {
    it('publishes when a text message is created', async () => {
      await request(`/v1/chat/threads/${threadId}/messages`, {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ body: 'Are you up?' }),
      });
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ type: 'message.created', threadId });
    });

    it('publishes when a voice note is created', async () => {
      // The stub has to be in place before presigning: without it that call reaches the
      // default storage, which answers 503 while no media backend is configured.
      const { setStorageForTests } = await import('@/lib/storage');
      setStorageForTests({
        async presignUpload(key) { return `https://bucket.example/${key}`; },
        async presignDownload(key) { return `https://bucket.example/${key}`; },
        async head() { return { contentType: 'audio/mp4', contentLength: 1024 }; },
        async remove() {},
      });

      try {
        const presigned = await request('/v1/uploads', {
          method: 'POST',
          token: asha,
          body: JSON.stringify({ kind: 'voice-note', contentType: 'audio/mp4', threadId }),
        });
        expect(presigned.status).toBe(200);

        const committed = await request('/v1/uploads/voice-note', {
          method: 'POST',
          token: asha,
          body: JSON.stringify({ key: presigned.body.key, durationSeconds: 7 }),
        });
        expect(committed.status).toBe(201);
      } finally {
        setStorageForTests(null);
      }

      expect(published.some((event) => event.type === 'message.created')).toBe(true);
    });

    it('still succeeds when realtime is unavailable', async () => {
      // A push failure must not turn a stored message into a failed request.
      setRealtimeForTests({
        async publishToThread() {
          throw new Error('FCM unreachable');
        },
      });

      const response = await request(`/v1/chat/threads/${threadId}/messages`, {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ body: 'still delivered' }),
      });
      expect(response.status).toBe(201);
      expect(await getDatabase().select().from(schema.messages)).toHaveLength(1);
    });
  });

  /**
   * The real implementation, not the fake. These cover the behaviour that replaced the
   * WebSocket registry: who gets woken, who does not, and what happens to a token FCM
   * has permanently rejected.
   */
  describe('push fan-out', () => {
    let sent: PushMessage[] = [];

    function notifier(result: (message: PushMessage) => Awaited<ReturnType<Notifier['send']>>): Notifier {
      return {
        async send(message) {
          sent.push(message);
          return result(message);
        },
      };
    }

    async function registerDevice(token: string, accessToken: string) {
      const response = await request('/v1/device-tokens', {
        method: 'POST',
        token: accessToken,
        body: JSON.stringify({ token, platform: 'android' }),
      });
      expect(response.status).toBeLessThan(300);
    }

    beforeEach(() => {
      sent = [];
      // Use the real push-based realtime for this block.
      setRealtimeForTests(null);
    });

    it('wakes the other participant and not the sender', async () => {
      await registerDevice('ravi-device-token', ravi);
      await registerDevice('asha-device-token', asha);
      setNotifierForTests(notifier(() => ({ ok: true })));

      const delivered = await getRealtime().publishToThread({
        type: 'message.created',
        threadId,
        payload: { messageId: 'abc', senderId: ashaId },
      });

      expect(delivered).toBe(1);
      expect(sent.map((m) => m.token)).toEqual(['ravi-device-token']);
    });

    it('sends silently and carries identifiers only, never message content', async () => {
      await registerDevice('ravi-device-token', ravi);
      setNotifierForTests(notifier(() => ({ ok: true })));

      await getRealtime().publishToThread({
        type: 'message.created',
        threadId,
        payload: { messageId: 'abc', senderId: ashaId, body: 'a private sentence' },
      });

      expect(sent[0]!.silent).toBe(true);
      expect(sent[0]!.data).toEqual({ type: 'message.created', threadId, messageId: 'abc' });
      expect(JSON.stringify(sent[0])).not.toContain('a private sentence');
    });

    it('deactivates a token FCM has permanently rejected', async () => {
      await registerDevice('dead-token', ravi);
      setNotifierForTests(notifier(() => ({ ok: false, invalidToken: true, error: 'not-registered' })));

      const delivered = await getRealtime().publishToThread({
        type: 'message.created',
        threadId,
        payload: { messageId: 'abc', senderId: ashaId },
      });

      expect(delivered).toBe(0);
      const [row] = await getDatabase()
        .select({ isActive: schema.deviceTokens.isActive })
        .from(schema.deviceTokens)
        .where(eq(schema.deviceTokens.userId, raviId));
      expect(row!.isActive).toBe(false);
    });

    it('leaves a token alone after a transient failure', async () => {
      await registerDevice('flaky-token', ravi);
      setNotifierForTests(notifier(() => ({ ok: false, invalidToken: false, error: 'unavailable' })));

      await getRealtime().publishToThread({
        type: 'message.created',
        threadId,
        payload: { messageId: 'abc', senderId: ashaId },
      });

      const [row] = await getDatabase()
        .select({ isActive: schema.deviceTokens.isActive })
        .from(schema.deviceTokens)
        .where(eq(schema.deviceTokens.userId, raviId));
      // A transient error must not cost the device its registration; the next message retries.
      expect(row!.isActive).toBe(true);
    });

    it('is a no-op when the recipient has no registered device', async () => {
      setNotifierForTests(notifier(() => ({ ok: true })));

      const delivered = await getRealtime().publishToThread({
        type: 'message.created',
        threadId,
        payload: { messageId: 'abc', senderId: ashaId },
      });

      expect(delivered).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it('does nothing for a thread that does not exist', async () => {
      setNotifierForTests(notifier(() => ({ ok: true })));

      const delivered = await getRealtime().publishToThread({
        type: 'message.created',
        threadId: '00000000-0000-0000-0000-000000000000',
        payload: { messageId: 'abc', senderId: ashaId },
      });

      expect(delivered).toBe(0);
      expect(sent).toHaveLength(0);
    });
  });

  describe('the worker trigger', () => {
    afterEach(() => {
      delete process.env.WORKER_TRIGGER_SECRET;
    });

    it('does not exist when no secret is configured', async () => {
      delete process.env.WORKER_TRIGGER_SECRET;
      const response = await request('/internal/run-worker', { method: 'POST' });
      expect(response.status).toBe(404);
    });

    it('refuses a wrong secret with the same 404, revealing nothing', async () => {
      process.env.WORKER_TRIGGER_SECRET = 'the-real-secret';
      const response = await request('/internal/run-worker', {
        method: 'POST',
        headers: { 'X-Worker-Secret': 'not-the-secret' },
      });
      expect(response.status).toBe(404);
    });

    it('runs the worker for the right secret', async () => {
      process.env.WORKER_TRIGGER_SECRET = 'the-real-secret';
      const response = await request('/internal/run-worker', {
        method: 'POST',
        headers: { 'X-Worker-Secret': 'the-real-secret' },
      });
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });
  });

  // Kept so an unused import does not drift in; signing is covered properly in auth tests.
  it('can sign an access token for the fixtures', async () => {
    expect(typeof (await signAccessToken({ userId: ashaId, email: 'asha@example.com' }))).toBe('string');
  });
});
