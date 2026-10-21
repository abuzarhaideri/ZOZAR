import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { hashPassword, verifyPassword, wastePasswordWork } from '@/auth/password';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '@/auth/tokens';
import { getDatabase, schema } from '@/db/client';
import { isUniqueViolation } from '@/db/errors';
import {
  apiError,
  badRequest,
  displayNameSchema,
  emailSchema,
  parseBody,
  passwordSchema,
  timezoneSchema,
  unauthorized,
  type AppEnv,
} from '@/lib/http';

export const authRoutes = new Hono<AppEnv>();

type SessionResponse = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: { id: string; email: string; displayName: string; timezone: string };
};

/** Issues a fresh token pair and opens a new rotation family. */
async function issueSession(
  user: { id: string; email: string; displayName: string; timezone: string },
): Promise<SessionResponse> {
  const database = getDatabase();
  const { token, tokenHash } = createRefreshToken();
  const familyId = crypto.randomUUID();

  await database.insert(schema.refreshTokens).values({
    userId: user.id,
    tokenHash,
    familyId,
    expiresAt: refreshTokenExpiry(),
  });

  return {
    accessToken: await signAccessToken({ userId: user.id, email: user.email }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: token,
    user,
  };
}

authRoutes.post('/sign-up', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      email: emailSchema,
      password: passwordSchema,
      displayName: displayNameSchema,
      timezone: timezoneSchema.default('UTC'),
    }),
  );

  const database = getDatabase();
  const passwordHash = await hashPassword(body.password);

  // Let the unique index on lower(email) decide, rather than checking first and then
  // inserting: two concurrent sign-ups would both pass a prior check.
  let inserted;
  try {
    [inserted] = await database
      .insert(schema.users)
      .values({
        email: body.email,
        passwordHash,
        displayName: body.displayName,
        timezone: body.timezone,
      })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        timezone: schema.users.timezone,
      });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw apiError(409, 'email_taken', 'An account with that email already exists.');
    }
    throw error;
  }
  if (!inserted) throw new Error('Insert returned no row.');

  return c.json(await issueSession(inserted), 201);
});

authRoutes.post('/sign-in', async (c) => {
  const body = await parseBody(c, z.object({ email: emailSchema, password: z.string().min(1) }));
  const database = getDatabase();

  const [user] = await database
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      timezone: schema.users.timezone,
      passwordHash: schema.users.passwordHash,
      passwordResetRequired: schema.users.passwordResetRequired,
    })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, body.email))
    .limit(1);

  if (!user) {
    // Spend comparable CPU so a missing account is not detectably faster than a wrong
    // password, which would otherwise let anyone enumerate registered emails.
    await wastePasswordWork();
    throw apiError(401, 'invalid_credentials', 'That email or password is incorrect.');
  }

  // A migrated account has no hash yet. Say so explicitly: it is not a wrong password, and
  // leaving the client to guess would strand the user. Knowing this does not grant access,
  // because claiming the account still requires the single-use token.
  if (!user.passwordHash) {
    throw apiError(
      409,
      'password_reset_required',
      'This account was migrated and needs a new password. Use the claim token you were sent.',
    );
  }

  if (!(await verifyPassword(body.password, user.passwordHash))) {
    throw apiError(401, 'invalid_credentials', 'That email or password is incorrect.');
  }

  return c.json(
    await issueSession({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      timezone: user.timezone,
    }),
  );
});

/**
 * Claims a migrated account by presenting the single-use token issued by the migration
 * script. Succeeds only while the account still has no password, so a replayed token
 * cannot overwrite a password the owner has since set.
 */
authRoutes.post('/claim-account', async (c) => {
  const body = await parseBody(
    c,
    z.object({ email: emailSchema, claimToken: z.string().min(1), password: passwordSchema }),
  );
  const database = getDatabase();
  const claimHash = hashRefreshToken(body.claimToken);
  const passwordHash = await hashPassword(body.password);

  const [claimed] = await database
    .update(schema.users)
    .set({
      passwordHash,
      passwordResetRequired: false,
      claimTokenHash: null,
      claimTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sql`lower(${schema.users.email})`, body.email),
        // Only an unclaimed account, and only with the matching unexpired token. All three
        // conditions live in the UPDATE so the check and the write cannot interleave.
        isNull(schema.users.passwordHash),
        eq(schema.users.claimTokenHash, claimHash),
        sql`${schema.users.claimTokenExpiresAt} > now()`,
      ),
    )
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      timezone: schema.users.timezone,
    });

  if (!claimed) {
    throw apiError(401, 'invalid_credentials', 'That claim token is not valid for this account.');
  }

  return c.json(await issueSession(claimed));
});

/**
 * Rotates a refresh token.
 *
 * Presenting a token that was already rotated means two parties hold the same token, so
 * one of them stole it. There is no way to tell which, so the whole family is revoked and
 * both are forced to sign in again. Losing a session is the correct price for detecting
 * a stolen one.
 */
authRoutes.post('/refresh', async (c) => {
  const body = await parseBody(c, z.object({ refreshToken: z.string().min(1) }));
  const database = getDatabase();
  const presentedHash = hashRefreshToken(body.refreshToken);

  const [existing] = await database
    .select({
      id: schema.refreshTokens.id,
      userId: schema.refreshTokens.userId,
      familyId: schema.refreshTokens.familyId,
      expiresAt: schema.refreshTokens.expiresAt,
      revokedAt: schema.refreshTokens.revokedAt,
    })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, presentedHash))
    .limit(1);

  if (!existing) throw unauthorized('That session has expired. Sign in again.');

  if (existing.revokedAt) {
    await revokeFamily(existing.familyId);
    throw unauthorized('That session was already used elsewhere. Sign in again.');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthorized('That session has expired. Sign in again.');
  }

  const [user] = await database
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      timezone: schema.users.timezone,
    })
    .from(schema.users)
    .where(eq(schema.users.id, existing.userId))
    .limit(1);

  if (!user) throw unauthorized('That account no longer exists.');

  const { token, tokenHash } = createRefreshToken();

  // Mark the old token spent and store the new one in the same transaction, so a failure
  // cannot leave a family with two live tokens or none.
  await database.transaction(async (tx) => {
    const [replacement] = await tx
      .insert(schema.refreshTokens)
      .values({
        userId: user.id,
        tokenHash,
        familyId: existing.familyId,
        expiresAt: refreshTokenExpiry(),
      })
      .returning({ id: schema.refreshTokens.id });

    await tx
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date(), replacedBy: replacement?.id ?? null })
      .where(eq(schema.refreshTokens.id, existing.id));
  });

  return c.json({
    accessToken: await signAccessToken({ userId: user.id, email: user.email }),
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: token,
    user,
  });
});

/** Signing out revokes the whole family, so every token descended from that sign-in dies
 * together rather than leaving a usable successor behind. */
authRoutes.post('/sign-out', async (c) => {
  const body = await parseBody(c, z.object({ refreshToken: z.string().min(1) }));
  const database = getDatabase();

  const [existing] = await database
    .select({ familyId: schema.refreshTokens.familyId })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hashRefreshToken(body.refreshToken)))
    .limit(1);

  // Always 204, even for an unknown token: sign-out must not report whether a token was
  // real, and the client's intent is satisfied either way.
  if (existing) await revokeFamily(existing.familyId);
  return c.body(null, 204);
});

async function revokeFamily(familyId: string): Promise<void> {
  const database = getDatabase();
  await database
    .update(schema.refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)));
}
