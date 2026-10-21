import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDatabase, schema } from '@/db/client';
import { sha256Hex } from '@/lib/hash';
import { parseBody, type AppEnv } from '@/lib/http';
import { session } from '@/lib/resources';

export const deviceRoutes = new Hono<AppEnv>();

/**
 * FCM registration tokens.
 *
 * The token itself is stored, because delivery needs it, but uniqueness is enforced on a
 * SHA-256 hash: FCM tokens exceed Postgres's btree key limit, so indexing the raw value
 * would fail. Appwrite needed the same trick for the same reason.
 */
deviceRoutes.post('/', async (c) => {
  const current = session(c);
  const body = await parseBody(
    c,
    z.object({
      token: z.string().trim().min(1).max(4096),
      platform: z.enum(['android', 'ios']).default('android'),
      deviceName: z.string().trim().max(128).nullish(),
    }),
  );

  const tokenHash = sha256Hex(body.token);

  const [row] = await getDatabase()
    .insert(schema.deviceTokens)
    .values({
      userId: current.userId,
      token: body.token,
      tokenHash,
      platform: body.platform,
      deviceName: body.deviceName ?? null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.deviceTokens.tokenHash,
      set: {
        // Reassigning userId is deliberate. FCM issues a token per app install, so the
        // same token reappearing under a different account means the device was handed
        // over or the app was signed into by someone else. Pushes must follow the current
        // owner, or the previous user keeps receiving another person's alarms.
        userId: current.userId,
        platform: body.platform,
        deviceName: body.deviceName ?? null,
        isActive: true,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({
      id: schema.deviceTokens.id,
      tokenHash: schema.deviceTokens.tokenHash,
      platform: schema.deviceTokens.platform,
      isActive: schema.deviceTokens.isActive,
      lastSeenAt: schema.deviceTokens.lastSeenAt,
    });

  return c.json({ deviceToken: row }, 201);
});

/**
 * Deactivates a device, by hash rather than by id, because that is what the client has
 * on hand at sign-out: it holds the FCM token, not the row it was stored as.
 *
 * Marked inactive rather than deleted, so a token FCM later reports as stale can still be
 * traced back instead of vanishing.
 */
deviceRoutes.delete('/', async (c) => {
  const current = session(c);
  const body = await parseBody(c, z.object({ token: z.string().trim().min(1).max(4096) }));

  await getDatabase()
    .update(schema.deviceTokens)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.deviceTokens.tokenHash, sha256Hex(body.token)),
        // Scoped to the caller, so one account cannot deactivate another's device.
        eq(schema.deviceTokens.userId, current.userId),
      ),
    );

  // Always 204: whether that token was registered to this account is not something an
  // unregister call should disclose, and the client's intent is satisfied either way.
  return c.body(null, 204);
});
