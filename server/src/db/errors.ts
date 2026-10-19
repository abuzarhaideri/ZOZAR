/**
 * Postgres error classification.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` and puts the `pg` `DatabaseError`,
 * which is what actually carries the SQLSTATE, on `cause`. Reading `error.code` off the
 * thrown object therefore finds nothing and silently misclassifies every constraint
 * violation as an unexpected failure. The cause chain is walked instead of reaching for
 * `error.cause.code` directly, so another wrapping layer cannot reintroduce the bug.
 */

/** https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const SQLSTATE = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  notNullViolation: '23502',
  checkViolation: '23514',
} as const;

export function sqlStateOf(error: unknown, depth = 5): string | null {
  let current: unknown = error;
  for (let step = 0; step <= depth && current; step += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (sqlStateOf(error) !== SQLSTATE.uniqueViolation) return false;
  if (!constraint) return true;
  return constraintOf(error) === constraint;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return sqlStateOf(error) === SQLSTATE.foreignKeyViolation;
}

/** Which constraint failed, so a table with several unique indexes can report the right
 * message instead of guessing. */
export function constraintOf(error: unknown, depth = 5): string | null {
  let current: unknown = error;
  for (let step = 0; step <= depth && current; step += 1) {
    if (typeof current === 'object' && 'constraint' in current) {
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === 'string') return constraint;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
