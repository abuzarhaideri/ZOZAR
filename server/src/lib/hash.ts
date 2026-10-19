import { createHash } from 'node:crypto';

/** SHA-256, hex encoded. Used for index keys over values too long to index directly, and
 * for storing opaque tokens without storing the token itself. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
