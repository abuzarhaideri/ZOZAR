import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema, type Database } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import {
  canReadConnection,
  canRespondToConnection,
  canRevokeConnection,
  canonicalPair,
  type ConnectionRow,
} from '@/domain/authz';
import { apiError, badRequest, conflict, enforce, notFound, parseBody, emailSchema, type AppEnv } from '@/lib/http';
import { session, uuidParam } from '@/lib/resources';

export const connectionRoutes = new Hono<AppEnv>();

const COLUMNS = {
  id: schema.connections.id,
  requesterId: schema.connections.requesterId,
  recipientId: schema.connections.recipientId,
  requesterEmail: schema.connections.requesterEmail,
  recipientEmail: schema.connections.recipientEmail,
  requesterDisplayName: schema.connections.requesterDisplayName,
  recipientDisplayName: schema.connections.recipientDisplayName,
  status: schema.connections.status,
  createdAt: schema.connections.createdAt,
  updatedAt: schema.connections.updatedAt,
} as const;

/**
 * A connection is visible to the requester, to a resolved recipient, and to someone whose
 * email it was addressed to before they had an account. That last case is what lets an
 * invite appear on the People screen for a user who signed up after being invited.
 */
function visibleTo(userId: string, email: string) {
  return or(
    eq(schema.connections.requesterId, userId),
    eq(schema.connections.recipientId, userId),
    and(isNull(schema.connections.recipientId), eq(sql`lower(${schema.connections.recipientEmail})`, email)),
  );
}

async function loadConnection(database: Database, id: string) {
  const [found] = await database.select(COLUMNS).from(schema.connections).where(eq(schema.connections.id, id)).limit(1);
  return found;
}

/** Narrows a loaded row to the shape the authz rules take, so the rules cannot drift from
 * the columns they reason about. */
function forAuthz(row: { requesterId: string; recipientId: string | null; recipientEmail: string; status: ConnectionRow['status'] }): ConnectionRow {
  return {
    requesterId: row.requesterId,
    recipientId: row.recipientId,
    recipientEmail: row.recipientEmail,
    status: row.status,
  };
}

connectionRoutes.get('/', async (c) => {
  const current = session(c);
  const rows = await getDatabase()
    .select(COLUMNS)
    .from(schema.connections)
    .where(visibleTo(current.userId, current.email.toLowerCase()));

  // The client needs to know which side it is on to label a row "waiting on them" versus
  // "waiting on you", and that cannot be derived from the row alone without the session.
  const connections = rows.map((row) => ({
    ...row,
    relationship: row.requesterId === current.userId ? ('outgoing' as const) : ('incoming' as const),
  }));

  return c.json({ connections });
});

connectionRoutes.post('/', async (c) => {
  const current = session(c);
  const body = await parseBody(c, z.object({ email: emailSchema }));
  const database = getDatabase();

  if (body.email === current.email.toLowerCase()) {
    throw badRequest('You cannot invite yourself.');
  }

  const [me] = await database
    .select({ displayName: schema.users.displayName, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, current.userId))
    .limit(1);
  if (!me) throw notFound('Your account no longer exists.');

  // Resolve the invitee if they already have an account, so the connection is usable
  // immediately. If not, the invite waits on the email address.
  const [invitee] = await database
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, body.email))
    .limit(1);

  try {
    const [created] = await database
      .insert(schema.connections)
      .values({
        requesterId: current.userId,
        recipientId: invitee?.id ?? null,
        requesterEmail: me.email,
        recipientEmail: body.email,
        requesterDisplayName: me.displayName,
        recipientDisplayName: invitee?.displayName ?? null,
      })
      .returning(COLUMNS);

    return c.json({ connection: { ...created, relationship: 'outgoing' as const } }, 201);
  } catch (error) {
    // The unique index on (requester_id, lower(recipient_email)) is what decides this,
    // rather than a prior lookup, so two concurrent invites cannot both succeed.
    if (isUniqueViolation(error, 'connections_requester_recipient_key')) {
      throw conflict('You have already invited that person.');
    }
    throw error;
  }
});

/**
 * Accept or decline an invitation.
 *
 * Accepting also opens the chat thread, in the same transaction as the status change: a
 * connection that is accepted but has no thread would leave the People screen offering a
 * conversation that 404s.
 */
connectionRoutes.post('/:id/respond', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();
  const body = await parseBody(c, z.object({ accept: z.boolean() }));

  const existing = await loadConnection(database, id);
  enforce(canRespondToConnection(current, existing ? forAuthz(existing) : null));
  if (!existing) throw notFound();

  const [me] = await database
    .select({ displayName: schema.users.displayName })
    .from(schema.users)
    .where(eq(schema.users.id, current.userId))
    .limit(1);

  const updated = await database.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.connections)
      .set({
        status: body.accept ? 'accepted' : 'declined',
        // Claim the invite for this account if it was only addressed by email.
        recipientId: existing.recipientId ?? current.userId,
        recipientDisplayName: existing.recipientDisplayName ?? me?.displayName ?? null,
        updatedAt: new Date(),
      })
      // Re-check the status in the UPDATE so two concurrent responses cannot both apply.
      .where(and(eq(schema.connections.id, id), eq(schema.connections.status, 'pending')))
      .returning(COLUMNS);

    if (!row) return null;

    if (body.accept) {
      const pair = canonicalPair(row.requesterId, current.userId);
      await tx
        .insert(schema.chatThreads)
        .values(pair)
        // One thread per pair. A second accepted connection between the same two people,
        // in either direction, reuses the conversation they already have.
        .onConflictDoNothing({
          target: [schema.chatThreads.participantA, schema.chatThreads.participantB],
        });
    }

    return row;
  });

  if (!updated) throw conflict('This invitation was already answered.');

  return c.json({ connection: { ...updated, relationship: 'incoming' as const } });
});

/** Either party may walk away. The thread and its messages are left in place, so neither
 * person silently loses their history because the other revoked. */
connectionRoutes.delete('/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const database = getDatabase();

  const existing = await loadConnection(database, id);
  enforce(canRevokeConnection(current, existing ? forAuthz(existing) : null));

  await database
    .update(schema.connections)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(schema.connections.id, id));

  // Any wake plan that named this person as its trusted contact no longer has one. Leaving
  // the reference would let the app keep promising protection that cannot be delivered.
  await database
    .update(schema.wakePlans)
    .set({ connectionId: null, updatedAt: new Date() })
    .where(eq(schema.wakePlans.connectionId, id));

  return c.body(null, 204);
});

connectionRoutes.get('/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const existing = await loadConnection(getDatabase(), id);
  enforce(canReadConnection(current, existing ? forAuthz(existing) : null));
  if (!existing) throw apiError(404, 'not_found', 'Connection does not exist.');
  return c.json({
    connection: {
      ...existing,
      relationship: existing.requesterId === current.userId ? 'outgoing' : 'incoming',
    },
  });
});
