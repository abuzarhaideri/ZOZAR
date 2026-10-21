import { describe, expect, it } from 'vitest';

import {
  canAccessOwnedRow,
  canChangeRetention,
  canReadConnection,
  canReadThread,
  canRespondToConnection,
  canRevokeConnection,
  canSendMessage,
  canonicalPair,
  isConnectionParty,
  profileVisibility,
  statusForDenial,
  type ConnectionRow,
  type Session,
} from '@/domain/authz';

const owner: Session = { userId: 'user-owner', email: 'owner@example.com' };
const stranger: Session = { userId: 'user-stranger', email: 'stranger@example.com' };
const invitee: Session = { userId: 'user-invitee', email: 'invitee@example.com' };

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    requesterId: owner.userId,
    recipientId: invitee.userId,
    recipientEmail: invitee.email,
    status: 'pending',
    ...overrides,
  };
}

describe('owner-only rows', () => {
  it('allows the owner', () => {
    expect(canAccessOwnedRow(owner, { userId: owner.userId })).toEqual({ allowed: true });
  });

  it('hides another user’s row as not found, not forbidden', () => {
    // Answering "forbidden" would confirm the row exists and leak that another user has
    // an alarm at that id.
    const decision = canAccessOwnedRow(stranger, { userId: owner.userId });
    expect(decision).toMatchObject({ allowed: false, reason: 'notFound' });
  });

  it('treats a missing row the same as an unauthorised one', () => {
    expect(canAccessOwnedRow(owner, null)).toMatchObject({ allowed: false, reason: 'notFound' });
    expect(canAccessOwnedRow(owner, undefined)).toMatchObject({ allowed: false, reason: 'notFound' });
  });
});

describe('connection parties', () => {
  it('recognises requester and recipient', () => {
    expect(isConnectionParty(owner, connection())).toBe(true);
    expect(isConnectionParty(invitee, connection())).toBe(true);
    expect(isConnectionParty(stranger, connection())).toBe(false);
  });

  it('matches an invitee by email before they have an account', () => {
    const pendingInvite = connection({ recipientId: null, recipientEmail: 'invitee@example.com' });
    expect(isConnectionParty(invitee, pendingInvite)).toBe(true);
    expect(isConnectionParty(stranger, pendingInvite)).toBe(false);
  });

  it('compares invite emails case-insensitively and ignores surrounding space', () => {
    const pendingInvite = connection({ recipientId: null, recipientEmail: '  INVITEE@Example.COM ' });
    expect(isConnectionParty(invitee, pendingInvite)).toBe(true);
  });

  it('does not match by email once the recipient has been resolved to another account', () => {
    const resolved = connection({ recipientId: 'someone-else', recipientEmail: invitee.email });
    expect(isConnectionParty(invitee, resolved)).toBe(false);
  });

  it('hides connections from unrelated users', () => {
    expect(canReadConnection(stranger, connection())).toMatchObject({ allowed: false, reason: 'notFound' });
    expect(canReadConnection(owner, connection())).toEqual({ allowed: true });
  });
});

describe('responding to a connection', () => {
  it('lets only the invitee accept or decline', () => {
    expect(canRespondToConnection(invitee, connection())).toEqual({ allowed: true });
    // The requester is a party, so the denial is forbidden rather than notFound.
    expect(canRespondToConnection(owner, connection())).toMatchObject({ allowed: false, reason: 'forbidden' });
  });

  it('lets an invitee respond to an invite addressed only by email', () => {
    expect(canRespondToConnection(invitee, connection({ recipientId: null }))).toEqual({ allowed: true });
  });

  it('refuses to re-answer a settled invitation', () => {
    for (const status of ['accepted', 'declined', 'revoked'] as const) {
      expect(canRespondToConnection(invitee, connection({ status }))).toMatchObject({
        allowed: false,
        reason: 'conflict',
      });
    }
  });

  it('still hides the connection from a stranger', () => {
    expect(canRespondToConnection(stranger, connection())).toMatchObject({ allowed: false, reason: 'notFound' });
  });
});

describe('revoking a connection', () => {
  it('lets either party revoke a live connection', () => {
    expect(canRevokeConnection(owner, connection({ status: 'accepted' }))).toEqual({ allowed: true });
    expect(canRevokeConnection(invitee, connection({ status: 'accepted' }))).toEqual({ allowed: true });
    expect(canRevokeConnection(owner, connection({ status: 'pending' }))).toEqual({ allowed: true });
  });

  it('reports an already-dead connection as a conflict', () => {
    expect(canRevokeConnection(owner, connection({ status: 'revoked' }))).toMatchObject({
      allowed: false,
      reason: 'conflict',
    });
    expect(canRevokeConnection(owner, connection({ status: 'declined' }))).toMatchObject({
      allowed: false,
      reason: 'conflict',
    });
  });
});

describe('chat threads', () => {
  const thread = { participantA: owner.userId, participantB: invitee.userId };

  it('admits only participants', () => {
    expect(canReadThread(owner, thread)).toEqual({ allowed: true });
    expect(canReadThread(invitee, thread)).toEqual({ allowed: true });
    expect(canReadThread(stranger, thread)).toMatchObject({ allowed: false, reason: 'notFound' });
  });

  it('gates sending and retention on the same participation rule', () => {
    expect(canSendMessage(stranger, thread)).toMatchObject({ allowed: false, reason: 'notFound' });
    expect(canChangeRetention(invitee, thread)).toEqual({ allowed: true });
  });

  it('hides a missing thread', () => {
    expect(canReadThread(owner, null)).toMatchObject({ allowed: false, reason: 'notFound' });
  });
});

describe('canonical thread pairs', () => {
  it('orders participants identically whichever way round they are given', () => {
    expect(canonicalPair('aaa', 'bbb')).toEqual(canonicalPair('bbb', 'aaa'));
    expect(canonicalPair('bbb', 'aaa')).toEqual({ participantA: 'aaa', participantB: 'bbb' });
  });

  it('is stable for a self-pair', () => {
    expect(canonicalPair('aaa', 'aaa')).toEqual({ participantA: 'aaa', participantB: 'aaa' });
  });
});

describe('profile visibility', () => {
  it('gives full access to your own profile', () => {
    expect(profileVisibility(owner, owner.userId, false)).toBe('full');
  });

  it('gives a connected person display-level access only', () => {
    expect(profileVisibility(owner, invitee.userId, true)).toBe('limited');
  });

  it('reveals nothing about an unconnected user, so profiles are not a directory', () => {
    expect(profileVisibility(owner, stranger.userId, false)).toBe('none');
  });
});

describe('denial status mapping', () => {
  it('maps each reason to one status, consistently across routes', () => {
    expect(statusForDenial('notFound')).toBe(404);
    expect(statusForDenial('forbidden')).toBe(403);
    expect(statusForDenial('conflict')).toBe(409);
  });
});
