/**
 * S3 object keys for user media, and the rules for who may read one.
 *
 * Keys are built by the server and then handed back by the client when it commits an
 * upload, so every key arriving from a client is untrusted input. Two things follow.
 *
 * First, a key must be parsed and validated rather than concatenated into a request: a
 * key like `profile-photos/<someone-else>/x.jpg` is a perfectly well-formed string, and
 * accepting it would let one account attach another's photo, or read it. `parseKey`
 * therefore returns the owning scope, and the caller checks that scope against the
 * session.
 *
 * Second, the pattern is deliberately strict — fixed prefix, UUID segments, short
 * extension allowlist — so `..`, absolute paths, encoded separators and unbounded
 * filenames cannot appear at all. The whole module is pure, so these rules are tested
 * without touching S3.
 */

export type MediaKind = 'profile-photo' | 'voice-note';

export type ParsedKey =
  | { kind: 'profile-photo'; userId: string; extension: string }
  | { kind: 'voice-note'; threadId: string; extension: string };

const PROFILE_PREFIX = 'profile-photos';
const VOICE_PREFIX = 'voice-notes';

/** Allowlists, not denylists. An unlisted type is rejected, so a new format has to be
 * considered rather than arriving by accident. */
export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const AUDIO_CONTENT_TYPES: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTENSION = /^[a-z0-9]{2,4}$/;

export function extensionForContentType(kind: MediaKind, contentType: string): string | null {
  const table = kind === 'profile-photo' ? IMAGE_CONTENT_TYPES : AUDIO_CONTENT_TYPES;
  return table[contentType.trim().toLowerCase()] ?? null;
}

export function profilePhotoKey(userId: string, objectId: string, extension: string): string {
  return `${PROFILE_PREFIX}/${userId}/${objectId}.${extension}`;
}

export function voiceNoteKey(threadId: string, objectId: string, extension: string): string {
  return `${VOICE_PREFIX}/${threadId}/${objectId}.${extension}`;
}

/**
 * Parses a key, returning null for anything that does not match exactly.
 *
 * Returning null rather than throwing keeps callers from having to distinguish "malformed"
 * from "not yours": both end as the same refusal, which is also what stops the response
 * from reporting whether a given key exists.
 */
export function parseKey(key: string): ParsedKey | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) return null;
  // Reject anything that could escape the intended prefix before looking at structure.
  if (key.includes('..') || key.includes('//') || key.startsWith('/') || key.includes('\\')) return null;
  if (key !== key.trim() || /[%\s]/.test(key)) return null;

  const segments = key.split('/');
  if (segments.length !== 3) return null;

  const [prefix, scope, filename] = segments as [string, string, string];
  if (!UUID.test(scope)) return null;

  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const objectId = filename.slice(0, dot);
  const extension = filename.slice(dot + 1);
  if (!UUID.test(objectId) || !EXTENSION.test(extension)) return null;

  if (prefix === PROFILE_PREFIX) return { kind: 'profile-photo', userId: scope, extension };
  if (prefix === VOICE_PREFIX) return { kind: 'voice-note', threadId: scope, extension };
  return null;
}

/**
 * Whether a parsed key may be read, given what the caller is.
 *
 * `connectedUserIds` is the set of people the caller has an accepted connection with, and
 * `threadIds` the conversations they are in. Both are resolved by the route; this function
 * does no I/O so the rule itself stays testable.
 */
export function canReadKey(
  parsed: ParsedKey,
  caller: { userId: string; connectedUserIds: ReadonlySet<string>; threadIds: ReadonlySet<string> },
): boolean {
  if (parsed.kind === 'profile-photo') {
    // Your own photo, or that of someone you are actually connected to. Profile photos
    // are not public, or the key space would double as a user directory.
    return parsed.userId === caller.userId || caller.connectedUserIds.has(parsed.userId);
  }
  return caller.threadIds.has(parsed.threadId);
}

/** Whether the caller may upload to this key. Stricter than reading: you may only ever
 * write your own photo, and only into a conversation you belong to. */
export function canWriteKey(
  parsed: ParsedKey,
  caller: { userId: string; threadIds: ReadonlySet<string> },
): boolean {
  if (parsed.kind === 'profile-photo') return parsed.userId === caller.userId;
  return caller.threadIds.has(parsed.threadId);
}
