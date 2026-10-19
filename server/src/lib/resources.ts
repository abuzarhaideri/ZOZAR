import type { Context } from 'hono';
import { z } from 'zod';

import { canAccessOwnedRow, type Session } from '@/domain/authz';
import { badRequest, enforce, notFound, type AppEnv } from '@/lib/http';

const uuidSchema = z.uuid();

/**
 * Reads a UUID path parameter.
 *
 * A malformed id is reported as 404, not 400. Postgres rejects invalid UUID syntax with
 * SQLSTATE 22P02, so passing one straight through would surface as a 500; and answering
 * 400 for "not a uuid" while answering 404 for "a uuid that does not exist" would tell a
 * caller which ids are well-formed. Both cases mean the same thing to a client: there is
 * nothing there.
 */
export function uuidParam(c: Context<AppEnv>, name = 'id'): string {
  const raw = c.req.param(name);
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export function session(c: Context<AppEnv>): Session {
  return c.get('session');
}

/**
 * Loads a row and resolves ownership through the authz rules before returning it.
 *
 * Routes call this instead of writing `where(eq(table.userId, session.userId))` inline.
 * Both would work, but only this path runs the shared rule, so the decision about what
 * non-owners are told stays in one place.
 */
export async function requireOwned<T extends { userId: string }>(
  current: Session,
  load: () => Promise<T | undefined>,
): Promise<T> {
  const row = await load();
  enforce(canAccessOwnedRow(current, row));
  // enforce throws unless the row exists and belongs to the caller.
  return row as T;
}

/** Rejects a PATCH body that would change nothing, so an empty object is a clear 400
 * rather than a silent success that returns an unchanged row. */
export function requireSomeFields<T extends object>(patch: T, message: string): T {
  const hasField = Object.values(patch).some((value) => value !== undefined);
  if (!hasField) throw badRequest(message);
  return patch;
}
