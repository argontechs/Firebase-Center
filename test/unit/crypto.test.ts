import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSecret, decryptSecret, fingerprint, type EncryptedSecret } from '~/server/utils/crypto';

// Ensure the test key is set when .env.test is not auto-loaded by the runner.
beforeAll(() => {
  // 32-byte key (brief's key was 37 bytes — corrected)
  process.env.NUXT_BO_MASTER_KEY ??= '1:R9mc6Tk1PgDnyHPhrOEHLt+UjY7wwcyVGNqMtJhWdI8=';
});

describe('crypto vault', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const plain = JSON.stringify({ private_key: 'abc', project_id: 'proj-1' });
    const enc = encryptSecret(plain);
    expect(enc.keyVersion).toBe(1);
    expect(enc.ciphertext).not.toContain('private_key');
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('uses a fresh 12-byte nonce every call (never reuses key,nonce)', () => {
    const a = encryptSecret('same-input');
    const b = encryptSecret('same-input');
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(a.nonce, 'base64')).toHaveLength(12);
  });

  it('throws on tamper (tag mismatch)', () => {
    const enc = encryptSecret('secret');
    const flipped = Buffer.from(enc.ciphertext, 'base64');
    flipped[0] ^= 0xff;
    const tampered: EncryptedSecret = { ...enc, ciphertext: flipped.toString('base64') };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('throws on unknown key version', () => {
    const enc = encryptSecret('secret');
    expect(() => decryptSecret({ ...enc, keyVersion: 99 })).toThrow(/unknown key version/i);
  });

  it('fingerprint is stable and non-reversible (does not leak the secret)', () => {
    const fp1 = fingerprint('the-app-secret');
    const fp2 = fingerprint('the-app-secret');
    expect(fp1).toBe(fp2);
    expect(fp1).not.toContain('the-app-secret');
    expect(fingerprint('different')).not.toBe(fp1);
  });
});
