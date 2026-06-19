import { describe, it, expect } from 'vitest';
import { generateIngestKey, verifyIngestKey } from '~/server/utils/ingest-keys';

describe('ingest key crypto', () => {
  it('generates a prefixed key, a 64-hex hash, and a stable display prefix', () => {
    const k = generateIngestKey();
    expect(k.fullKey).toMatch(/^bo_ik_[A-Za-z0-9_-]{32,}$/);
    expect(k.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.fullKey.startsWith(k.keyPrefix)).toBe(true);
    expect(k.keyPrefix.length).toBeLessThan(k.fullKey.length);
  });

  it('verifies a matching key and rejects a non-matching one', () => {
    const k = generateIngestKey();
    expect(verifyIngestKey(k.fullKey, k.keyHash)).toBe(true);
    expect(verifyIngestKey('bo_ik_wrong', k.keyHash)).toBe(false);
  });

  it('produces unique keys across calls', () => {
    expect(generateIngestKey().fullKey).not.toBe(generateIngestKey().fullKey);
  });
});
