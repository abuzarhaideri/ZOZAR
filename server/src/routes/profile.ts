import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema } from '@/db/client';
import { displayNameSchema, notFound, parseBody, timezoneSchema, type AppEnv } from '@/lib/http';
import { requireSomeFields, session } from '@/lib/resources';

export const profileRoutes = new Hono<AppEnv>();

const COLUMNS = {
  id: schema.users.id,
  email: schema.users.email,
  displayName: schema.users.displayName,
  timezone: schema.users.timezone,
  photoKey: schema.users.photoKey,
  createdAt: schema.users.createdAt,
  updatedAt: schema.users.updatedAt,
} as const;

/** Your own profile, in full. Other people's profiles are never served from here; the
 * chat and connection routes expose only display fields, per the rules in authz.ts. */
profileRoutes.get('/', async (c) => {
  const [row] = await getDatabase()
    .select(COLUMNS)
    .from(schema.users)
    .where(eq(schema.users.id, session(c).userId))
    .limit(1);

  if (!row) throw notFound('Your account no longer exists.');
  return c.json({ profile: row });
});

profileRoutes.patch('/', async (c) => {
  const current = session(c);
  const body = requireSomeFields(
    await parseBody(
      c,
      z.object({
        displayName: displayNameSchema.optional(),
        timezone: timezoneSchema.optional(),
      }),
    ),
    'Provide at least one field to update.',
  );

  // Email is deliberately not updatable here. Changing it would move the account's
  // identity, orphan pending invitations addressed to the old address, and needs a
  // verification step this API does not yet have.
  const [updated] = await getDatabase()
    .update(schema.users)
    .set({
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, current.userId))
    .returning(COLUMNS);

  if (!updated) throw notFound('Your account no longer exists.');
  return c.json({ profile: updated });
});
