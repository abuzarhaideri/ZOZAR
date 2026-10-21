import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { z } from 'zod';

import { statusForDenial, type Decision, type Session } from '@/domain/authz';

/** Hono variable map, so `c.get('session')` is typed rather than `any`. */
export type AppEnv = {
  Variables: {
    session: Session;
  };
};

/**
 * Every error the client sees has a stable machine-readable `code` alongside its message.
 * The app branches on the code; the message is for humans and may be reworded freely.
 */
export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_credentials'
  | 'password_reset_required'
  | 'email_taken'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

export function apiError(status: number, code: ApiErrorCode, message: string): HTTPException {
  return new HTTPException(status as 400, {
    res: Response.json({ error: { code, message } }, { status }),
  });
}

export const badRequest = (message: string) => apiError(400, 'invalid_request', message);
export const unauthorized = (message = 'Sign in to continue.') => apiError(401, 'unauthorized', message);
export const notFound = (message = 'Not found.') => apiError(404, 'not_found', message);
export const conflict = (message: string) => apiError(409, 'conflict', message);

/**
 * Turns an authorization decision into either a return or a thrown HTTP error, so route
 * handlers read as a straight line and cannot accidentally continue past a denial.
 */
export function enforce(decision: Decision): void {
  if (decision.allowed) return;
  const status = statusForDenial(decision.reason);
  const code: ApiErrorCode = status === 403 ? 'forbidden' : status === 409 ? 'conflict' : 'not_found';
  throw apiError(status, code, decision.detail);
}

/**
 * Parses a JSON body against a schema, reporting the first field problem rather than a
 * Zod dump. Returns 400 for malformed JSON too, which an empty body produces.
 */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Expected a JSON body.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    throw badRequest(path ? `${path}: ${first?.message}` : (first?.message ?? 'Invalid request body.'));
  }
  return result.data;
}

/** Emails are compared and stored case-folded, because `A@x.com` and `a@x.com` are the
 * same mailbox and the unique index is on `lower(email)`. */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email('Enter a valid email address.')
  .transform((value) => value.toLowerCase());

/**
 * A 12-character floor, with no composition rules.
 *
 * Length contributes far more entropy than mandatory symbol classes, and composition
 * rules push people toward predictable substitutions. NIST SP 800-63B recommends exactly
 * this trade-off. The upper bound only exists so a megabyte of input cannot be fed to
 * scrypt as a denial-of-service.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(256, 'Use at most 256 characters.');

export const displayNameSchema = z.string().trim().min(1, 'Enter your name.').max(128);

/** IANA zone name, validated by asking Intl rather than against a hardcoded list. */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone.');
