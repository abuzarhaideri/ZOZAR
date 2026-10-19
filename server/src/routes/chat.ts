import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema, type Database } from '@/db/client';
import { canChangeRetention, canReadThread, canSendMessage, type Session } from '@/domain/authz';
import { retentionExpiry } from '@/domain/schedule';
import { enforce, notFound, parseBody, type AppEnv } from '@/lib/http';
import { session, uuidParam } from '@/lib/resources';

export const chatRoutes = new Hono<AppEnv>();

const THREAD_COLUMNS = {
  id: schema.chatThreads.id,
  participantA: schema.chatThreads.participantA,
  participantB: schema.chatThreads.participantB,
  retention: schema.chatThreads.retention,
  retentionChangedBy: schema.chatThreads.retentionChangedBy,
  retentionChangedAt: schema.chatThreads.retentionChangedAt,
  createdAt: schema.chatThreads.createdAt,
} as const;

const MESSAGE_COLUMNS = {
  id: schema.messages.id,
  threadId: schema.messages.threadId,
  senderId: schema.messages.senderId,
  type: schema.messages.type,
  body: schema.messages.body,
  voiceKey: schema.messages.voiceKey,
  voiceDurationSeconds: schema.messages.voiceDurationSeconds,
  createdAt: schema.messages.createdAt,
  expiresAt: schema.messages.expiresAt,
} as const;

async function loadThread(database: Database, id: string) {
  const [found] = await database.select(THREAD_COLUMNS).from(schema.chatThreads).where(eq(schema.chatThreads.id, id)).limit(1);
  return found;
}

/** Resolves a thread the caller is allowed to see, or throws. Every chat route starts
 * here so participation is checked exactly once per request, in one place. */
async function requireThread(database: Database, id: string, current: Session) {
  const thread = await loadThread(database, id);
  enforce(canReadThread(current, thread ?? null));
  if (!thread) throw notFound();
  return thread;
}

chatRoutes.get('/threads', async (c) => {
  const current = session(c);
  const database = getDatabase();

  const threads = await database
    .select(THREAD_COLUMNS)
    .from(schema.chatThreads)
    .where(
      or(
        eq(schema.chatThreads.participantA, current.userId),
        eq(schema.chatThreads.participantB, current.userId),
      ),
    );

  if (threads.length === 0) return c.json({ threads: [] });

  // The client renders the other person's name and photo, so resolve them here rather
  // than making the app fetch a profile per thread. Only display fields are exposed:
  // being in a conversation does not entitle you to someone's email or timezone.
  const others = threads.map((thread) =>
    thread.participantA === current.userId ? thread.participantB : thread.participantA,
  );

  const profiles = await database
    .select({ id: schema.users.id, displayName: schema.users.displayName, photoKey: schema.users.photoKey })
    .from(schema.users)
    // inArray, not a raw `any(...)` template: interpolating a JS array into raw SQL binds
    // it as a single parameter, which Postgres rejects as a malformed array literal.
    .where(inArray(schema.users.id, others));

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));

  return c.json({
    threads: threads.map((thread) => {
      const otherId = thread.participantA === current.userId ? thread.participantB : thread.participantA;
      const other = byId.get(otherId);
      return {
        ...thread,
        other: { id: otherId, displayName: other?.displayName ?? null, photoKey: other?.photoKey ?? null },
      };
    }),
  });
});

chatRoutes.get('/threads/:id', async (c) => {
  const id = uuidParam(c);
  const thread = await requireThread(getDatabase(), id, session(c));
  return c.json({ thread });
});

chatRoutes.get('/threads/:id/messages', async (c) => {
  const id = uuidParam(c);
  const database = getDatabase();
  await requireThread(database, id, session(c));

  const messages = await database
    .select(MESSAGE_COLUMNS)
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.threadId, id),
        // Expired messages are filtered on read, not only swept by the worker. The
        // retention promise is "gone after 7 days", and a reader must not see a message
        // past its expiry just because the sweep has not run yet.
        gt(schema.messages.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.messages.createdAt))
    .limit(200);

  return c.json({ messages });
});

chatRoutes.post('/threads/:id/messages', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();
  const body = await parseBody(
    c,
    z.object({ body: z.string().trim().min(1, 'Write something to send.').max(4096) }),
  );

  const thread = await loadThread(database, id);
  enforce(canSendMessage(current, thread ?? null));
  if (!thread) throw notFound();

  // Expiry is stamped from the thread's retention at insert time rather than computed on
  // read, so later changing the retention does not retroactively delete or resurrect
  // messages people have already exchanged.
  const [created] = await database
    .insert(schema.messages)
    .values({
      threadId: id,
      senderId: current.userId,
      type: 'text',
      body: body.body,
      expiresAt: retentionExpiry(thread.retention),
    })
    .returning(MESSAGE_COLUMNS);

  return c.json({ message: created }, 201);
});

/**
 * Retention governs how long both people's messages survive, so either participant may
 * change it, and the row records who did.
 *
 * It applies to messages sent from now on. Shortening it does not reach back and delete
 * what the other person already sent, which would let one party unilaterally erase a
 * shared history.
 */
chatRoutes.patch('/threads/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();
  const body = await parseBody(c, z.object({ retention: z.enum(['7d', '30d']) }));

  const thread = await loadThread(database, id);
  enforce(canChangeRetention(current, thread ?? null));
  if (!thread) throw notFound();

  const [updated] = await database
    .update(schema.chatThreads)
    .set({
      retention: body.retention,
      retentionChangedBy: current.userId,
      retentionChangedAt: new Date(),
    })
    .where(eq(schema.chatThreads.id, id))
    .returning(THREAD_COLUMNS);

  return c.json({ thread: updated });
});
