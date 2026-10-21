import { describe, expect, it } from 'vitest';

import {
  canReadKey,
  canWriteKey,
  extensionForContentType,
  parseKey,
  profilePhotoKey,
  voiceNoteKey,
} from '@/domain/storage-keys';

const ME = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const THREAD = '44444444-4444-4444-8444-444444444444';
const OTHER_THREAD = '55555555-5555-4555-8555-555555555555';
const OBJECT = '66666666-6666-4666-8666-666666666666';

const caller = {
  userId: ME,
  connectedUserIds: new Set([FRIEND]),
  threadIds: new Set([THREAD]),
};

describe('content type allowlist', () => {
  it('maps permitted types to extensions', () => {
    expect(extensionForContentType('profile-photo', 'image/jpeg')).toBe('jpg');
    expect(extensionForContentType('profile-photo', 'IMAGE/PNG')).toBe('png');
    expect(extensionForContentType('voice-note', 'audio/mp4')).toBe('m4a');
  });

  it('rejects a type outside its kind, so audio cannot be uploaded as a photo', () => {
    expect(extensionForContentType('profile-photo', 'audio/mp4')).toBeNull();
    expect(extensionForContentType('voice-note', 'image/png')).toBeNull();
  });

  it('rejects unlisted and dangerous types', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript', '', 'image/*']) {
      expect(extensionForContentType('profile-photo', type), type).toBeNull();
    }
  });
});

describe('key round-trip', () => {
  it('parses a key it built', () => {
    expect(parseKey(profilePhotoKey(ME, OBJECT, 'jpg'))).toEqual({
      kind: 'profile-photo',
      userId: ME,
      extension: 'jpg',
    });
    expect(parseKey(voiceNoteKey(THREAD, OBJECT, 'm4a'))).toEqual({
      kind: 'voice-note',
      threadId: THREAD,
      extension: 'm4a',
    });
  });
});

describe('key parsing rejects hostile input', () => {
  it('refuses path traversal and absolute paths', () => {
    const hostile = [
      `profile-photos/${ME}/../../etc/passwd`,
      `profile-photos/../${STRANGER}/${OBJECT}.jpg`,
      `/profile-photos/${ME}/${OBJECT}.jpg`,
      `profile-photos//${ME}/${OBJECT}.jpg`,
      `profile-photos\\${ME}\\${OBJECT}.jpg`,
      `profile-photos/${ME}/%2e%2e/${OBJECT}.jpg`,
    ];
    for (const key of hostile) {
      expect(parseKey(key), key).toBeNull();
    }
  });

  it('refuses an unknown prefix', () => {
    expect(parseKey(`secrets/${ME}/${OBJECT}.jpg`)).toBeNull();
    expect(parseKey(`${OBJECT}.jpg`)).toBeNull();
  });

  it('refuses a non-UUID scope or object id', () => {
    expect(parseKey(`profile-photos/not-a-uuid/${OBJECT}.jpg`)).toBeNull();
    expect(parseKey(`profile-photos/${ME}/not-a-uuid.jpg`)).toBeNull();
  });

  it('refuses a missing or implausible extension', () => {
    expect(parseKey(`profile-photos/${ME}/${OBJECT}`)).toBeNull();
    expect(parseKey(`profile-photos/${ME}/${OBJECT}.`)).toBeNull();
    expect(parseKey(`profile-photos/${ME}/${OBJECT}.verylongextension`)).toBeNull();
    expect(parseKey(`profile-photos/${ME}/.${OBJECT}`)).toBeNull();
  });

  it('refuses extra path depth, which could place an object outside its scope', () => {
    expect(parseKey(`profile-photos/${ME}/nested/${OBJECT}.jpg`)).toBeNull();
    expect(parseKey(`profile-photos/${ME}`)).toBeNull();
  });

  it('refuses whitespace, padding and absurd length', () => {
    expect(parseKey(` profile-photos/${ME}/${OBJECT}.jpg`)).toBeNull();
    expect(parseKey(`profile-photos/${ME}/${OBJECT}.jpg `)).toBeNull();
    expect(parseKey('')).toBeNull();
    expect(parseKey(`profile-photos/${ME}/${'x'.repeat(300)}.jpg`)).toBeNull();
  });
});

describe('read authorization', () => {
  it('allows your own photo', () => {
    expect(canReadKey(parseKey(profilePhotoKey(ME, OBJECT, 'jpg'))!, caller)).toBe(true);
  });

  it('allows a connected person’s photo', () => {
    expect(canReadKey(parseKey(profilePhotoKey(FRIEND, OBJECT, 'jpg'))!, caller)).toBe(true);
  });

  it('refuses a stranger’s photo, so keys are not a user directory', () => {
    expect(canReadKey(parseKey(profilePhotoKey(STRANGER, OBJECT, 'jpg'))!, caller)).toBe(false);
  });

  it('allows a voice note only in a conversation you are in', () => {
    expect(canReadKey(parseKey(voiceNoteKey(THREAD, OBJECT, 'm4a'))!, caller)).toBe(true);
    expect(canReadKey(parseKey(voiceNoteKey(OTHER_THREAD, OBJECT, 'm4a'))!, caller)).toBe(false);
  });
});

describe('write authorization', () => {
  it('lets you write only your own photo', () => {
    expect(canWriteKey(parseKey(profilePhotoKey(ME, OBJECT, 'jpg'))!, caller)).toBe(true);
    // Being connected lets you see their photo, never replace it.
    expect(canWriteKey(parseKey(profilePhotoKey(FRIEND, OBJECT, 'jpg'))!, caller)).toBe(false);
    expect(canWriteKey(parseKey(profilePhotoKey(STRANGER, OBJECT, 'jpg'))!, caller)).toBe(false);
  });

  it('lets you write a voice note only into your own conversation', () => {
    expect(canWriteKey(parseKey(voiceNoteKey(THREAD, OBJECT, 'm4a'))!, caller)).toBe(true);
    expect(canWriteKey(parseKey(voiceNoteKey(OTHER_THREAD, OBJECT, 'm4a'))!, caller)).toBe(false);
  });

  it('is strictly narrower than reading', () => {
    // Every writable key must also be readable; the reverse must not hold.
    const friendPhoto = parseKey(profilePhotoKey(FRIEND, OBJECT, 'jpg'))!;
    expect(canReadKey(friendPhoto, caller)).toBe(true);
    expect(canWriteKey(friendPhoto, caller)).toBe(false);
  });
});
