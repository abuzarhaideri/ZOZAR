import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache, signAccessToken } from '@/auth/tokens';
import { handler } from '@/handlers/ws';
import { setRealtimeForTests, type Realtime, type RealtimeEvent } from '@/realtime/publish';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

/** Builds the API Gateway WebSocket event shape the handler receives. */
function wsEvent(routeKey: string, connectionId: string, extras: Record<string, unknown> = {}) {
  return {
    requestContext: { routeKey, connectionId, eventType: routeKey },
    isBase64Encoded: false,
    ...extras,
  } as never;
}

async function invoke(routeKey: string, connectionId: string, extras: Record<string, unknown> = {}) {
  const result = (await handler(wsEvent(routeKey, connectionId, extras))) as {
    statusCode: number;
    body?: string;
  };
  return result;
}

suite('websocket handler and realtime', () => {
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
  let nosy = '';
  let threadId = '';
  let ashaId = '';

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
    nosy = await signUp('nosy@example.com');

    const [me] = await getDatabase()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, 'asha@example.com'));
    ashaId = me!.id;

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
  });

  afterAll(async () => {
    await closeDatabase();
  });

  describe('$connect', () => {
    it('registers a connection for a valid token', async () => {
      const result = await invoke('$connect', 'conn-1', { queryStringParameters: { token: asha } });
      expect(result.statusCode).toBe(200);

      const rows = await getDatabase().select().from(schema.wsConnections);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ connectionId: 'conn-1', userId: ashaId, threadId: null });
    });

    it('refuses the handshake with no token, so no socket is ever established', async () => {
      const result = await invoke('$connect', 'conn-2', {});
      expect(result.statusCode).toBe(401);
      expect(await getDatabase().select().from(schema.wsConnections)).toHaveLength(0);
    });

    it('refuses a forged or expired token', async () => {
      for (const token of ['not-a-jwt', 'a.b.c', '']) {
        const result = await invoke('$connect', 'conn-x', { queryStringParameters: { token } });
        expect(result.statusCode, token).toBe(401);
      }
      expect(await getDatabase().select().from(schema.wsConnections)).toHaveLength(0);
    });

    it('refuses a token signed with a different secret', async () => {
      process.env.JWT_SECRET = 'a-totally-different-secret-value-32-bytes';
      resetSigningKeyCache();
      const foreign = await signAccessToken({ userId: ashaId, email: 'asha@example.com' });
      process.env.JWT_SECRET = 'test-secret-value-that-is-long-enough-32';
      resetSigningKeyCache();

      const result = await invoke('$connect', 'conn-3', { queryStringParameters: { token: foreign } });
      expect(result.statusCode).toBe(401);
    });

    it('tolerates a retried connect for the same id', async () => {
      await invoke('$connect', 'conn-1', { queryStringParameters: { token: asha } });
      const again = await invoke('$connect', 'conn-1', { queryStringParameters: { token: asha } });
      expect(again.statusCode).toBe(200);
      expect(await getDatabase().select().from(schema.wsConnections)).toHaveLength(1);
    });
  });

  describe('$disconnect', () => {
    it('removes the registration', async () => {
      await invoke('$connect', 'conn-1', { queryStringParameters: { token: asha } });
      expect((await invoke('$disconnect', 'conn-1')).statusCode).toBe(200);
      expect(await getDatabase().select().from(schema.wsConnections)).toHaveLength(0);
    });

    it('is harmless for an unknown connection', async () => {
      expect((await invoke('$disconnect', 'never-existed')).statusCode).toBe(200);
    });
  });

  describe('messages from the client', () => {
    async function connected(token: string, id: string) {
      await invoke('$connect', id, { queryStringParameters: { token } });
      return id;
    }

    it('subscribes to a thread the caller is in', async () => {
      await connected(asha, 'conn-1');
      const result = await invoke('$default', 'conn-1', {
        body: JSON.stringify({ action: 'subscribe', threadId }),
      });
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body!)).toMatchObject({ type: 'subscribed', threadId });

      const [row] = await getDatabase().select().from(schema.wsConnections);
      expect(row?.threadId).toBe(threadId);
    });

    it('refuses to subscribe to a thread the caller is not in', async () => {
      // Re-checked here rather than assumed from the connect-time token, or a client
      // could subscribe to any thread id it guessed.
      await connected(nosy, 'conn-9');
      const result = await invoke('$default', 'conn-9', {
        body: JSON.stringify({ action: 'subscribe', threadId }),
      });
      expect(result.statusCode).toBe(404);

      const [row] = await getDatabase().select().from(schema.wsConnections);
      expect(row?.threadId).toBeNull();
    });

    it('refuses messages from an unregistered connection', async () => {
      const result = await invoke('$default', 'ghost', {
        body: JSON.stringify({ action: 'subscribe', threadId }),
      });
      expect(result.statusCode).toBe(401);
    });

    it('answers a ping and freshens the row', async () => {
      await connected(asha, 'conn-1');
      await getDatabase()
        .update(schema.wsConnections)
        .set({ lastSeenAt: new Date(Date.now() - 3600_000) })
        .where(eq(schema.wsConnections.connectionId, 'conn-1'));

      const result = await invoke('$default', 'conn-1', { body: JSON.stringify({ action: 'ping' }) });
      expect(JSON.parse(result.body!)).toEqual({ type: 'pong' });

      const [row] = await getDatabase().select().from(schema.wsConnections);
      expect(Date.now() - row!.lastSeenAt.getTime()).toBeLessThan(10_000);
    });

    it('rejects malformed JSON and unknown actions', async () => {
      await connected(asha, 'conn-1');
      expect((await invoke('$default', 'conn-1', { body: 'not json' })).statusCode).toBe(400);
      expect(
        (await invoke('$default', 'conn-1', { body: JSON.stringify({ action: 'publish' }) })).statusCode,
      ).toBe(400);
      expect(
        (await invoke('$default', 'conn-1', { body: JSON.stringify({ action: 'subscribe' }) })).statusCode,
      ).toBe(400);
    });

    it('does not accept message writes over the socket', async () => {
      // Writes go through the HTTP API so exactly one path authorizes them.
      await connected(asha, 'conn-1');
      const result = await invoke('$default', 'conn-1', {
        body: JSON.stringify({ action: 'send', threadId, body: 'over the socket' }),
      });
      expect(result.statusCode).toBe(400);
      expect(await getDatabase().select().from(schema.messages)).toHaveLength(0);
    });
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
      // real S3 path and fails for want of AWS_REGION.
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
      // A WebSocket failure must not turn a stored message into a failed request.
      setRealtimeForTests({
        async publishToThread() {
          throw new Error('API Gateway unreachable');
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
});
