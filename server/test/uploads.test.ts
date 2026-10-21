import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { createApp } from '@/app';
import { closeDatabase, getDatabase, schema } from '@/db/client';
import { resetSigningKeyCache } from '@/auth/tokens';
import { setStorageForTests, type MediaStorage, type ObjectHead } from '@/lib/storage';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

/** An in-memory stand-in for S3. Presigning is local crypto, but HeadObject is a network
 * call, and the cases worth testing — committing a key you do not own, an oversized
 * object — should not need a bucket. */
function fakeStorage() {
  const objects = new Map<string, ObjectHead>();
  const removed: string[] = [];
  const storage: MediaStorage = {
    async presignUpload(key) {
      return `https://bucket.example/${key}?signature=upload`;
    },
    async presignDownload(key) {
      return `https://bucket.example/${key}?signature=download`;
    },
    async head(key) {
      return objects.get(key) ?? null;
    },
    async remove(key) {
      removed.push(key);
      objects.delete(key);
    },
  };
  return { storage, objects, removed };
}

suite('upload routes', () => {
  const app = createApp();
  let fake = fakeStorage();

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
    fake = fakeStorage();
    setStorageForTests(fake.storage);

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
    setStorageForTests(null);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  const presign = (token: string, body: Record<string, unknown>) =>
    request('/v1/uploads', { method: 'POST', token, body: JSON.stringify(body) });

  describe('issuing upload URLs', () => {
    it('issues a photo URL scoped to the caller', async () => {
      const response = await presign(asha, { kind: 'profile-photo', contentType: 'image/jpeg' });
      expect(response.status).toBe(200);
      // The server chooses the key; the client never proposes one.
      expect(response.body.key).toMatch(new RegExp(`^profile-photos/${ashaId}/[0-9a-f-]{36}\\.jpg$`));
      expect(response.body.uploadUrl).toContain('signature=upload');
    });

    it('issues a voice note URL for a conversation the caller is in', async () => {
      const response = await presign(asha, { kind: 'voice-note', contentType: 'audio/mp4', threadId });
      expect(response.status).toBe(200);
      expect(response.body.key).toMatch(new RegExp(`^voice-notes/${threadId}/[0-9a-f-]{36}\\.m4a$`));
    });

    it('refuses to sign a URL for someone else’s conversation', async () => {
      const response = await presign(nosy, { kind: 'voice-note', contentType: 'audio/mp4', threadId });
      expect(response.status).toBe(404);
    });

    it('requires a threadId for a voice note', async () => {
      expect((await presign(asha, { kind: 'voice-note', contentType: 'audio/mp4' })).status).toBe(400);
    });

    it('rejects a content type outside the allowlist', async () => {
      for (const contentType of ['image/svg+xml', 'text/html', 'application/javascript']) {
        expect((await presign(asha, { kind: 'profile-photo', contentType })).status, contentType).toBe(400);
      }
    });

    it('rejects audio declared as a photo and vice versa', async () => {
      expect((await presign(asha, { kind: 'profile-photo', contentType: 'audio/mp4' })).status).toBe(400);
      expect(
        (await presign(asha, { kind: 'voice-note', contentType: 'image/png', threadId })).status,
      ).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await request('/v1/uploads', { method: 'POST', body: '{}' })).status).toBe(401);
    });
  });

  describe('committing a profile photo', () => {
    async function uploaded(token: string, size = 1024, contentType = 'image/jpeg') {
      const { body } = await presign(token, { kind: 'profile-photo', contentType });
      fake.objects.set(body.key, { contentType, contentLength: size });
      return body.key as string;
    }

    it('sets the photo once the object exists', async () => {
      const key = await uploaded(asha);
      const response = await request('/v1/uploads/profile-photo', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key }),
      });
      expect(response.status).toBe(200);
      expect(response.body.profile.photoKey).toBe(key);
    });

    it('refuses a key that was never uploaded', async () => {
      const { body } = await presign(asha, { kind: 'profile-photo', contentType: 'image/jpeg' });
      const response = await request('/v1/uploads/profile-photo', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key: body.key }),
      });
      expect(response.status).toBe(400);
    });

    it('refuses and deletes an oversized object', async () => {
      const key = await uploaded(asha, 6 * 1024 * 1024);
      const response = await request('/v1/uploads/profile-photo', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key }),
      });
      expect(response.status).toBe(400);
      // Left in place it would cost money forever.
      expect(fake.removed).toContain(key);
    });

    it('refuses and deletes an object whose real type is not an image', async () => {
      const key = await uploaded(asha, 1024, 'image/jpeg');
      fake.objects.set(key, { contentType: 'text/html', contentLength: 1024 });
      const response = await request('/v1/uploads/profile-photo', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key }),
      });
      expect(response.status).toBe(400);
      expect(fake.removed).toContain(key);
    });

    it('refuses a key belonging to another user', async () => {
      const key = await uploaded(ravi);
      const response = await request('/v1/uploads/profile-photo', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key }),
      });
      expect(response.status).toBe(404);
    });

    it('refuses traversal and malformed keys', async () => {
      for (const key of [
        `profile-photos/${ashaId}/../../etc/passwd`,
        '/profile-photos/x/y.jpg',
        'secrets/a/b.jpg',
        `voice-notes/${threadId}/00000000-0000-4000-8000-000000000000.m4a`,
      ]) {
        const response = await request('/v1/uploads/profile-photo', {
          method: 'POST',
          token: asha,
          body: JSON.stringify({ key }),
        });
        expect([400, 404], key).toContain(response.status);
      }
    });

    it('removes the previous photo when replaced', async () => {
      const first = await uploaded(asha);
      await request('/v1/uploads/profile-photo', { method: 'POST', token: asha, body: JSON.stringify({ key: first }) });
      const second = await uploaded(asha);
      await request('/v1/uploads/profile-photo', { method: 'POST', token: asha, body: JSON.stringify({ key: second }) });
      expect(fake.removed).toContain(first);
    });
  });

  describe('committing a voice note', () => {
    async function uploadedVoice(token: string, id = threadId, size = 2048) {
      const { body } = await presign(token, { kind: 'voice-note', contentType: 'audio/mp4', threadId: id });
      fake.objects.set(body.key, { contentType: 'audio/mp4', contentLength: size });
      return body.key as string;
    }

    it('creates a voice message in the thread', async () => {
      const key = await uploadedVoice(asha);
      const response = await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key, durationSeconds: 12 }),
      });
      expect(response.status).toBe(201);
      expect(response.body.message).toMatchObject({ type: 'voice', voiceDurationSeconds: 12 });

      const messages = await request(`/v1/chat/threads/${threadId}/messages`, { token: ravi });
      expect(messages.body.messages).toHaveLength(1);
    });

    it('rejects an implausible duration', async () => {
      const key = await uploadedVoice(asha);
      for (const durationSeconds of [0, -5, 601]) {
        const response = await request('/v1/uploads/voice-note', {
          method: 'POST',
          token: asha,
          body: JSON.stringify({ key, durationSeconds }),
        });
        expect(response.status, String(durationSeconds)).toBe(400);
      }
    });

    it('refuses a key for a conversation the caller is not in', async () => {
      const key = await uploadedVoice(asha);
      const response = await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: nosy,
        body: JSON.stringify({ key, durationSeconds: 5 }),
      });
      expect(response.status).toBe(404);
    });

    it('refuses and deletes an oversized recording', async () => {
      const key = await uploadedVoice(asha, threadId, 11 * 1024 * 1024);
      const response = await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key, durationSeconds: 30 }),
      });
      expect(response.status).toBe(400);
      expect(fake.removed).toContain(key);
    });
  });

  describe('download URLs', () => {
    async function commitPhoto(token: string) {
      const { body } = await presign(token, { kind: 'profile-photo', contentType: 'image/jpeg' });
      fake.objects.set(body.key, { contentType: 'image/jpeg', contentLength: 512 });
      await request('/v1/uploads/profile-photo', { method: 'POST', token, body: JSON.stringify({ key: body.key }) });
      return body.key as string;
    }

    it('signs your own photo', async () => {
      const key = await commitPhoto(asha);
      const response = await request(`/v1/uploads/download?key=${encodeURIComponent(key)}`, { token: asha });
      expect(response.status).toBe(200);
      expect(response.body.downloadUrl).toContain('signature=download');
    });

    it('signs a connected person’s photo', async () => {
      const key = await commitPhoto(ravi);
      const response = await request(`/v1/uploads/download?key=${encodeURIComponent(key)}`, { token: asha });
      expect(response.status).toBe(200);
    });

    it('refuses an unconnected person’s photo, so keys are not a directory', async () => {
      const key = await commitPhoto(ravi);
      const response = await request(`/v1/uploads/download?key=${encodeURIComponent(key)}`, { token: nosy });
      expect(response.status).toBe(404);
    });

    it('signs a voice note for a participant and refuses an outsider', async () => {
      const { body } = await presign(asha, { kind: 'voice-note', contentType: 'audio/mp4', threadId });
      fake.objects.set(body.key, { contentType: 'audio/mp4', contentLength: 2048 });
      await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key: body.key, durationSeconds: 8 }),
      });

      const query = `?key=${encodeURIComponent(body.key)}`;
      expect((await request(`/v1/uploads/download${query}`, { token: ravi })).status).toBe(200);
      expect((await request(`/v1/uploads/download${query}`, { token: nosy })).status).toBe(404);
    });

    it('stops serving a voice note past its retention', async () => {
      const { body } = await presign(asha, { kind: 'voice-note', contentType: 'audio/mp4', threadId });
      fake.objects.set(body.key, { contentType: 'audio/mp4', contentLength: 2048 });
      await request('/v1/uploads/voice-note', {
        method: 'POST',
        token: asha,
        body: JSON.stringify({ key: body.key, durationSeconds: 8 }),
      });
      await getDatabase()
        .update(schema.messages)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.messages.voiceKey, body.key));

      // The object may still be in the bucket awaiting its lifecycle sweep, but it must
      // stop being reachable the moment it expires.
      const response = await request(`/v1/uploads/download?key=${encodeURIComponent(body.key)}`, { token: asha });
      expect(response.status).toBe(404);
    });

    it('refuses a missing or malformed key', async () => {
      expect((await request('/v1/uploads/download', { token: asha })).status).toBe(400);
      expect((await request('/v1/uploads/download?key=nope', { token: asha })).status).toBe(404);
    });
  });
});
