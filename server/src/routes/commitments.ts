import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema } from '@/db/client';
import { badRequest, parseBody, type AppEnv } from '@/lib/http';
import { requireOwned, requireSomeFields, session, uuidParam } from '@/lib/resources';

export const commitmentRoutes = new Hono<AppEnv>();

const COLUMNS = {
  id: schema.commitments.id,
  userId: schema.commitments.userId,
  title: schema.commitments.title,
  description: schema.commitments.description,
  startsAt: schema.commitments.startsAt,
  endsAt: schema.commitments.endsAt,
  status: schema.commitments.status,
  completedAt: schema.commitments.completedAt,
  createdAt: schema.commitments.createdAt,
  updatedAt: schema.commitments.updatedAt,
} as const;

/** The API speaks ISO-8601 instants, not the client's '7:00 AM' display strings. Parsing
 * display text is the client's job; accepting it here would bake one locale's formatting
 * into the wire contract. */
const instant = z.coerce.date();

commitmentRoutes.get('/', async (c) => {
  const rows = await getDatabase()
    .select(COLUMNS)
    .from(schema.commitments)
    .where(eq(schema.commitments.userId, session(c).userId))
    .orderBy(asc(schema.commitments.startsAt));
  return c.json({ commitments: rows });
});

commitmentRoutes.get('/:id', async (c) => {
  const id = uuidParam(c);
  const row = await requireOwned(session(c), async () => {
    const [found] = await getDatabase().select(COLUMNS).from(schema.commitments).where(eq(schema.commitments.id, id)).limit(1);
    return found;
  });
  return c.json({ commitment: row });
});

commitmentRoutes.post('/', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      title: z.string().trim().min(1, 'Give this commitment a title.').max(160),
      description: z.string().trim().max(500).nullish(),
      startsAt: instant,
      endsAt: instant.nullish(),
    }),
  );

  if (body.endsAt && body.endsAt.getTime() <= body.startsAt.getTime()) {
    throw badRequest('endsAt must be after startsAt.');
  }

  const [created] = await getDatabase()
    .insert(schema.commitments)
    .values({
      userId: session(c).userId,
      title: body.title,
      description: body.description ?? null,
      startsAt: body.startsAt,
      endsAt: body.endsAt ?? null,
    })
    .returning(COLUMNS);

  return c.json({ commitment: created }, 201);
});

commitmentRoutes.patch('/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const body = requireSomeFields(
    await parseBody(
      c,
      z.object({
        title: z.string().trim().min(1).max(160).optional(),
        description: z.string().trim().max(500).nullish(),
        startsAt: instant.optional(),
        endsAt: instant.nullish(),
        status: z.enum(['planned', 'completed', 'archived']).optional(),
      }),
    ),
    'Provide at least one field to update.',
  );

  await requireOwned(current, async () => {
    const [found] = await getDatabase()
      .select({ userId: schema.commitments.userId })
      .from(schema.commitments)
      .where(eq(schema.commitments.id, id))
      .limit(1);
    return found;
  });

  // `completed_at` is derived from status rather than accepted from the client, so the
  // timestamp cannot disagree with the status it is supposed to explain.
  const completedAt =
    body.status === undefined ? undefined : body.status === 'completed' ? new Date() : null;

  const [updated] = await getDatabase()
    .update(schema.commitments)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.startsAt !== undefined && { startsAt: body.startsAt }),
      ...(body.endsAt !== undefined && { endsAt: body.endsAt }),
      ...(body.status !== undefined && { status: body.status }),
      ...(completedAt !== undefined && { completedAt }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, current.userId)))
    .returning(COLUMNS);

  return c.json({ commitment: updated });
});

/** Separate from PATCH because the client toggles completion far more often than it edits
 * a commitment, and a dedicated route keeps that one-tap action from having to send a
 * whole object. */
commitmentRoutes.post('/:id/complete', async (c) => {
  const id = uuidParam(c);
  const current = session(c);
  const body = await parseBody(c, z.object({ complete: z.boolean() }));

  await requireOwned(current, async () => {
    const [found] = await getDatabase()
      .select({ userId: schema.commitments.userId })
      .from(schema.commitments)
      .where(eq(schema.commitments.id, id))
      .limit(1);
    return found;
  });

  const [updated] = await getDatabase()
    .update(schema.commitments)
    .set({
      status: body.complete ? 'completed' : 'planned',
      completedAt: body.complete ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, current.userId)))
    .returning(COLUMNS);

  return c.json({ commitment: updated });
});

commitmentRoutes.delete('/:id', async (c) => {
  const id = uuidParam(c);
  const current = session(c);

  await requireOwned(current, async () => {
    const [found] = await getDatabase()
      .select({ userId: schema.commitments.userId })
      .from(schema.commitments)
      .where(eq(schema.commitments.id, id))
      .limit(1);
    return found;
  });

  // Wake plans reference commitments with ON DELETE SET NULL, so deleting a commitment
  // detaches its alarms rather than silently cancelling them.
  await getDatabase()
    .delete(schema.commitments)
    .where(and(eq(schema.commitments.id, id), eq(schema.commitments.userId, current.userId)));

  return c.body(null, 204);
});
