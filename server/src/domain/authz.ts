/**
 * Authorization rules, as pure functions.
 *
 * Appwrite enforced access per row, server-side, so the client could not read what it did
 * not own. Removing Appwrite removes that guarantee, and this module is what replaces it.
 * Every route resolves a decision here before touching data; no route writes its own
 * ownership check, because a check that exists in only one of fifteen handlers is the
 * shape most access-control bugs take.
 *
 * Nothing here performs I/O. Callers load the row, ask for a decision, and act on it,
 * which makes the entire security boundary testable without a database.
 */

export type Session = {
  userId: string;
  email: string;
};

/**
 * `notFound` versus `forbidden` is a security decision, not cosmetic. Telling an
 * unauthorised caller "forbidden" confirms the row exists, which leaks the existence of
 * other users' alarms and commitments. Resources keyed by an unguessable id therefore
 * deny with `notFound`.
 *
 * `forbidden` is reserved for cases where the caller legitimately knows the resource
 * exists — a connection addressed to them, a thread they are in — but may not perform
 * that particular action.
 */
export type DenyReason = 'notFound' | 'forbidden' | 'conflict';

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason; detail: string };

const ALLOW: Decision = { allowed: true };

function deny(reason: DenyReason, detail: string): Decision {
  return { allowed: false, reason, detail };
}

/** Rows whose access rule is simply ownership: commitments, wake plans, wake occurrences,
 * device tokens. Absent rows and other users' rows are indistinguishable by design. */
export function canAccessOwnedRow(
  session: Session,
  row: { userId: string } | null | undefined,
): Decision {
  if (!row) return deny('notFound', 'Resource does not exist.');
  if (row.userId !== session.userId) return deny('notFound', 'Resource does not exist.');
  return ALLOW;
}

export type ConnectionRow = {
  requesterId: string;
  recipientId: string | null;
  recipientEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
};

function emailMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A connection is a two-sided object: the invitee is identified by email until they have
 * an account, so recipient matching falls back to the email on the row. */
export function isConnectionParty(session: Session, connection: ConnectionRow): boolean {
  if (connection.requesterId === session.userId) return true;
  if (connection.recipientId && connection.recipientId === session.userId) return true;
  return !connection.recipientId && emailMatches(connection.recipientEmail, session.email);
}

export function canReadConnection(session: Session, connection: ConnectionRow | null | undefined): Decision {
  if (!connection) return deny('notFound', 'Connection does not exist.');
  if (!isConnectionParty(session, connection)) return deny('notFound', 'Connection does not exist.');
  return ALLOW;
}

/**
 * Only the invited party may accept or decline, and only while the invite is pending.
 * Denials here are `forbidden` rather than `notFound`: the caller is a party to the
 * connection, so its existence is not a secret from them.
 */
export function canRespondToConnection(
  session: Session,
  connection: ConnectionRow | null | undefined,
): Decision {
  if (!connection) return deny('notFound', 'Connection does not exist.');
  if (!isConnectionParty(session, connection)) return deny('notFound', 'Connection does not exist.');

  const isRecipient =
    (connection.recipientId && connection.recipientId === session.userId) ||
    (!connection.recipientId && emailMatches(connection.recipientEmail, session.email));

  if (!isRecipient) {
    return deny('forbidden', 'Only the invited person can respond to this invitation.');
  }
  if (connection.status !== 'pending') {
    return deny('conflict', `This invitation was already ${connection.status}.`);
  }
  return ALLOW;
}

/** Either side can walk away, at any point that leaves something to walk away from.
 * Revoking an already-dead connection is a conflict, not a silent success, so the client
 * does not show a stale row as removed. */
export function canRevokeConnection(
  session: Session,
  connection: ConnectionRow | null | undefined,
): Decision {
  if (!connection) return deny('notFound', 'Connection does not exist.');
  if (!isConnectionParty(session, connection)) return deny('notFound', 'Connection does not exist.');
  if (connection.status === 'revoked' || connection.status === 'declined') {
    return deny('conflict', 'This connection is no longer active.');
  }
  return ALLOW;
}

export type ThreadRow = {
  participantA: string;
  participantB: string;
};

export function isThreadParticipant(session: Session, thread: ThreadRow): boolean {
  return thread.participantA === session.userId || thread.participantB === session.userId;
}

export function canReadThread(session: Session, thread: ThreadRow | null | undefined): Decision {
  if (!thread) return deny('notFound', 'Conversation does not exist.');
  if (!isThreadParticipant(session, thread)) return deny('notFound', 'Conversation does not exist.');
  return ALLOW;
}

/** Reading and writing a thread carry the same rule today. They are separate functions
 * because they are separate questions, and a future change to one must not silently
 * change the other. */
export function canSendMessage(session: Session, thread: ThreadRow | null | undefined): Decision {
  return canReadThread(session, thread);
}

/** Retention governs how long both people's messages survive, so either participant may
 * set it. The row records who last changed it. */
export function canChangeRetention(session: Session, thread: ThreadRow | null | undefined): Decision {
  return canReadThread(session, thread);
}

/**
 * How much of another person's profile the caller may see.
 *
 * `full` is your own record. `limited` exposes display name and photo only, and is granted
 * solely to people you have an accepted connection with, so the People screen can render
 * them. Everyone else is `none`: profiles are not publicly enumerable, which keeps the
 * email-addressed invite flow from doubling as a user directory.
 */
export type ProfileVisibility = 'full' | 'limited' | 'none';

export function profileVisibility(
  session: Session,
  targetUserId: string,
  hasAcceptedConnection: boolean,
): ProfileVisibility {
  if (targetUserId === session.userId) return 'full';
  return hasAcceptedConnection ? 'limited' : 'none';
}

/**
 * Chat threads store their participants in sorted order and a unique index enforces one
 * thread per pair. Without a canonical order, (a,b) and (b,a) would both insert and the
 * two people would sit in different conversations.
 */
export function canonicalPair(first: string, second: string): { participantA: string; participantB: string } {
  return first <= second
    ? { participantA: first, participantB: second }
    : { participantA: second, participantB: first };
}

/** Maps a denial to its HTTP status, so every route reports the same rule the same way. */
export function statusForDenial(reason: DenyReason): 404 | 403 | 409 {
  switch (reason) {
    case 'notFound':
      return 404;
    case 'forbidden':
      return 403;
    case 'conflict':
      return 409;
  }
}
