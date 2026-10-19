import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import { sha256Hex } from '@/lib/hash';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 60;

const ISSUER = 'zozar-api';
const AUDIENCE = 'zozar-app';

export type SessionClaims = {
  userId: string;
  email: string;
};

let cachedKey: Uint8Array | undefined;

function signingKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error('Missing required environment variable: JWT_SECRET');
  // HS256 keys must be at least as long as the hash output or the construction is weaker
  // than advertised. 32 bytes is the floor, not a style preference.
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes. Generate one with: openssl rand -base64 48');
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

/** Short-lived bearer token. Deliberately stateless: verifying it must not cost a database
 * connection, because connections are the scarcest resource in this deployment. */
export async function signAccessToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

/** Returns null for anything invalid: bad signature, wrong issuer or audience, expired, or
 * missing a subject. Callers map null to 401 and never inspect why. */
export async function verifyAccessToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    return claimsFromPayload(payload);
  } catch {
    return null;
  }
}

function claimsFromPayload(payload: JWTPayload): SessionClaims | null {
  const userId = payload.sub;
  const email = payload.email;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (typeof email !== 'string') return null;
  return { userId, email };
}

/**
 * Opaque refresh token. 32 bytes of CSPRNG output, base64url encoded. It carries no
 * claims, so it cannot be read or forged offline, and only its hash reaches the database.
 */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

/**
 * Plain SHA-256, intentionally not scrypt. The token is already 256 bits of uniform
 * randomness, so there is no low-entropy guess to slow down, and refresh runs on every
 * token expiry where latency is visible.
 */
export function hashRefreshToken(token: string): string {
  return sha256Hex(token);
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Reads a bearer token out of an Authorization header, case-insensitively on the scheme.
 * Returns null when the header is absent or malformed. */
export function bearerFromHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/** Test seam: the signing key is cached per container, so tests that swap JWT_SECRET must
 * clear it. Production code never calls this. */
export function resetSigningKeyCache(): void {
  cachedKey = undefined;
}
