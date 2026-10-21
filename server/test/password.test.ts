import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/auth/password';

describe('password hashing', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('Correct horse battery staple', hash)).resolves.toBe(false);
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    const [first, second] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(first).not.toBe(second);
    await expect(verifyPassword('same-password', first)).resolves.toBe(true);
    await expect(verifyPassword('same-password', second)).resolves.toBe(true);
  });

  it('encodes its parameters so the work factor can be raised later', async () => {
    const hash = await hashPassword('whatever');
    expect(hash.split('$').slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
  });

  it('treats a migrated account with no hash as unverifiable rather than open', async () => {
    // Accounts imported from Appwrite arrive with password_hash NULL. An empty password
    // must not authenticate them.
    await expect(verifyPassword('', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
  });

  it('returns false for malformed stored hashes instead of throwing', async () => {
    for (const malformed of ['', 'garbage', 'scrypt$1$2$3', 'bcrypt$32768$8$1$c2FsdA==$aGFzaA==', 'scrypt$x$8$1$c2FsdA==$aGFzaA==']) {
      await expect(verifyPassword('anything', malformed)).resolves.toBe(false);
    }
  });

  it('normalises unicode so the same typed password verifies across input methods', async () => {
    // U+00E9 versus e + U+0301: visually identical, different bytes.
    const hash = await hashPassword('café-pass');
    await expect(verifyPassword('café-pass', hash)).resolves.toBe(true);
  });
});
