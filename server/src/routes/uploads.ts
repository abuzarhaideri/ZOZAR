import { randomUUID } from 'node:crypto';
import { and, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema, type Database } from '@/db/client';
import { canReadKey, canWriteKey, extensionForContentType, parseKey, profilePhotoKey, voiceNoteKey } from '@/domain/storage-keys';
import { retentionExpiry } from '@/domain/schedule';
import { badRequest, notFound, parseBody, type AppEnv } from '@/lib/http';
import { session, uuidParam } from '@/lib/resources';
import { publishQuietly } from '@/realtime/publish';
import {
  MAX_PHOTO_BYTES,
  MAX_VOICE_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  getStorage,
  type MediaStorage,
} from '@/lib/storage';

export const uploadRoutes = new Hono<AppEnv>();

/** The conversations the caller belongs to, and the people they are connected to. Both
 * sets feed the pure key rules in domain/storage-keys.ts. */
async function callerScopes(database: Database, userId: string) {
  const threads = await database
    .select({ id: schema.chatThreads.id, a: schema.chatThreads.participantA, b: schema.chatThreads.participantB })
    .from(schema.chatThreads)
    .where(or(eq(schema.chatThreads.participantA, userId), eq(schema.chatThreads.participantB, userId)));

  const connections = await database
    .select({ requesterId: schema.connections.requesterId, recipientId: schema.connections.recipientId })
    .from(schema.connections)
    .where(
      and(
        eq(schema.connections.status, 'accepted'),
        or(eq(schema.connections.requesterId, userId), eq(schema.connections.recipientId, userId)),
      ),
    );

  const connectedUserIds = new Set<string>();
  for (const row of connections) {
    const other = row.requesterId === userId ? row.recipientId : row.requesterId;
    if (other) connectedUserIds.add(other);
  }

  return { threadIds: new Set(threads.map((t) => t.id)), connectedUserIds };
}

/**
 * Issues a presigned PUT.
 *
 * The server chooses the key; the client never proposes one. That is what keeps an upload
 * inside the caller's own scope, since a client-supplied key would otherwise be the whole
 * attack surface.
 */
uploadRoutes.post('/', async (c) => {
  const current = session(c);
  const database = getDatabase();
  const body = await parseBody(
    c,
    z.object({
      kind: z.enum(['profile-photo', 'voice-note']),
      contentType: z.string().trim().min(1).max(128),
      threadId: z.uuid().optional(),
    }),
  );

  const extension = extensionForContentType(body.kind, body.contentType);
  if (!extension) throw badRequest(`${body.contentType} is not an accepted ${body.kind} type.`);

  let key: string;
  if (body.kind === 'profile-photo') {
    key = profilePhotoKey(current.userId, randomUUID(), extension);
  } else {
    if (!body.threadId) throw badRequest('A voice note needs a threadId.');
    const scopes = await callerScopes(database, current.userId);
    // Checked before signing: a URL for a conversation the caller is not in must never
    // be issued, even though the commit step would also refuse it.
    if (!scopes.threadIds.has(body.threadId)) throw notFound('Conversation does not exist.');
    key = voiceNoteKey(body.threadId, randomUUID(), extension);
  }

  const uploadUrl = await getStorage().presignUpload(key, body.contentType);
  return c.json({ key, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS, contentType: body.contentType });
});

/**
 * Verifies an uploaded object before anything references it.
 *
 * A presigned PUT cannot cap body size without making the client commit to an exact
 * Content-Length, so the size limit is enforced here instead. An object that is missing,
 * oversized, or of the wrong type is rejected, and an oversized one is deleted rather
 * than left to sit in the bucket costing money.
 */
async function verifyUpload(
  storage: MediaStorage,
  key: string,
  limit: number,
  allowed: (contentType: string | null) => boolean,
): Promise<void> {
  const head = await storage.head(key);
  if (!head) throw badRequest('That upload was not found. Upload the file before committing it.');

  if (head.contentLength > limit) {
    await storage.remove(key);
    throw badRequest(`That file is too large. The limit is ${Math.floor(limit / (1024 * 1024))} MB.`);
  }
  if (!allowed(head.contentType)) {
    await storage.remove(key);
    throw badRequest('That file type is not accepted.');
  }
}

uploadRoutes.post('/profile-photo', async (c) => {
  const current = session(c);
  const database = getDatabase();
  const storage = getStorage();
  const body = await parseBody(c, z.object({ key: z.string().min(1).max(200) }));

  const parsed = parseKey(body.key);
  // Every key arriving from a client is untrusted. Parsing rejects traversal and malformed
  // shapes; canWriteKey then confirms it is the caller's own scope.
  if (!parsed || parsed.kind !== 'profile-photo') throw badRequest('That is not a profile photo key.');
  if (!canWriteKey(parsed, { userId: current.userId, threadIds: new Set() })) {
    throw notFound('That upload does not exist.');
  }

  await verifyUpload(storage, body.key, MAX_PHOTO_BYTES, (type) => !!type && type.startsWith('image/'));

  const [previous] = await database
    .select({ photoKey: schema.users.photoKey })
    .from(schema.users)
    .where(eq(schema.users.id, current.userId))
    .limit(1);

  const [updated] = await database
    .update(schema.users)
    .set({ photoKey: body.key, updatedAt: new Date() })
    .where(eq(schema.users.id, current.userId))
    .returning({
      id: schema.users.id,
      displayName: schema.users.displayName,
      photoKey: schema.users.photoKey,
    });

  // Replaced photos are removed after the row points at the new one, so a failure here
  // leaves an orphan object rather than a profile pointing at a deleted file.
  if (previous?.photoKey && previous.photoKey !== body.key) {
    await storage.remove(previous.photoKey).catch((error) => {
      console.error('[uploads] could not remove replaced photo', { error });
    });
  }

  return c.json({ profile: updated });
});

uploadRoutes.post('/voice-note', async (c) => {
  const current = session(c);
  const database = getDatabase();
  const body = await parseBody(
    c,
    z.object({
      key: z.string().min(1).max(200),
      durationSeconds: z.number().int().min(1).max(600),
    }),
  );

  const parsed = parseKey(body.key);
  if (!parsed || parsed.kind !== 'voice-note') throw badRequest('That is not a voice note key.');

  const scopes = await callerScopes(database, current.userId);
  if (!canWriteKey(parsed, { userId: current.userId, threadIds: scopes.threadIds })) {
    throw notFound('Conversation does not exist.');
  }

  await verifyUpload(getStorage(), body.key, MAX_VOICE_BYTES, (type) => !!type && type.startsWith('audio/'));

  const [thread] = await database
    .select({ retention: schema.chatThreads.retention })
    .from(schema.chatThreads)
    .where(eq(schema.chatThreads.id, parsed.threadId))
    .limit(1);
  if (!thread) throw notFound('Conversation does not exist.');

  const [created] = await database
    .insert(schema.messages)
    .values({
      threadId: parsed.threadId,
      senderId: current.userId,
      type: 'voice',
      voiceKey: body.key,
      voiceDurationSeconds: body.durationSeconds,
      expiresAt: retentionExpiry(thread.retention),
    })
    .returning({
      id: schema.messages.id,
      threadId: schema.messages.threadId,
      senderId: schema.messages.senderId,
      type: schema.messages.type,
      voiceKey: schema.messages.voiceKey,
      voiceDurationSeconds: schema.messages.voiceDurationSeconds,
      createdAt: schema.messages.createdAt,
      expiresAt: schema.messages.expiresAt,
    });

  await publishQuietly({
    type: 'message.created',
    threadId: parsed.threadId,
    payload: { messageId: created?.id ?? '', senderId: current.userId },
  });

  return c.json({ message: created }, 201);
});

/**
 * Issues a presigned GET for media the caller is allowed to see.
 *
 * The bucket itself stays private: nothing is public-read, so this route and its
 * authorization check are the only way an object is reachable.
 */
uploadRoutes.get('/download', async (c) => {
  const current = session(c);
  const database = getDatabase();
  const key = c.req.query('key');
  if (!key) throw badRequest('A key is required.');

  const parsed = parseKey(key);
  if (!parsed) throw notFound('That file does not exist.');

  const scopes = await callerScopes(database, current.userId);
  if (!canReadKey(parsed, { userId: current.userId, ...scopes })) {
    // 404 rather than 403, so a caller cannot probe which keys exist.
    throw notFound('That file does not exist.');
  }

  // A voice note past its retention must stop being reachable even while the object is
  // still in the bucket awaiting the lifecycle sweep.
  if (parsed.kind === 'voice-note') {
    const [message] = await database
      .select({ expiresAt: schema.messages.expiresAt })
      .from(schema.messages)
      .where(eq(schema.messages.voiceKey, key))
      .limit(1);
    if (!message || message.expiresAt.getTime() <= Date.now()) {
      throw notFound('That file does not exist.');
    }
  }

  const downloadUrl = await getStorage().presignDownload(key);
  return c.json({ downloadUrl });
});
