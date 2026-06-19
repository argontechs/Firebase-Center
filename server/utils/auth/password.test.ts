import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('produces an argon2id encoded hash distinct from the plaintext', async () => {
    const hash = await hashPassword('Sup3r-Secret!');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Sup3r-Secret!');
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('Sup3r-Secret!');
    expect(await verifyPassword(hash, 'Sup3r-Secret!')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('Sup3r-Secret!');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('returns false (never throws) on a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-hash', 'x')).toBe(false);
  });

  it('produces different hashes for the same input (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });
});
