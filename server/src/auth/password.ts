import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * `promisify` resolves to node:crypto's three-argument scrypt overload, which cannot take
 * the cost parameters. The signature is restated here so the options argument type-checks
 * instead of being cast away at each call site.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt from node:crypto, chosen over argon2 and bcrypt because both of those are native
 * addons. A native addon has to be compiled for the Lambda architecture and bundled as a
 * binary, which breaks a plain esbuild bundle; node:crypto ships with the runtime.
 *
 * N = 2^15 with r = 8 costs ~32 MiB and ~50-100 ms per hash, which is a sensible 2026
 * work factor. Node's default maxmem is 32 MiB and these parameters need exactly that, so
 * maxmem is raised to leave headroom rather than fail at the boundary.
 */
const COST: ScryptOptions = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_BYTES = 32;
const SALT_BYTES = 32;

/** `scrypt$N$r$p$salt$hash`, both values base64. Embedding the parameters means the work
 * factor can be raised later without invalidating existing hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_BYTES, COST);
  return [
    'scrypt',
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Returns false rather than throwing for any malformed or unknown hash, so a corrupt row
 * cannot be distinguished from a wrong password by an attacker watching responses.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64');
    expected = Buffer.from(parts[5]!, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: COST.maxmem,
    });
    // Lengths already match by construction, so timingSafeEqual cannot throw here.
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Burns comparable CPU to a real verification. Sign-in calls this when no user row exists
 * so that a missing account and a wrong password take the same time, closing an account
 * enumeration oracle.
 */
export async function wastePasswordWork(): Promise<void> {
  await scrypt('timing-equalizer', randomBytes(SALT_BYTES), KEY_BYTES, COST);
}
