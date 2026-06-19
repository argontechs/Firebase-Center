/**
 * send-keys.test.ts
 *
 * Unit tests: generateSendKey, verifySendKey — pure crypto, no DB.
 * Integration tests: issueSendKey, rotateSendKey, revokeSendKey, resolveActiveSendKey
 *   — uses the real test-PG via server/test/db.ts (NUXT_DATABASE_URL).
 *   Migration must already be applied before running these tests (docker-compose
 *   runs migrations on boot; `pnpm db:migrate` for local dev).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { db, truncate, closeDb } from '~~/server/test/db';
import {
  generateSendKey,
  verifySendKey,
  issueSendKey,
  rotateSendKey,
  revokeSendKey,
  resolveActiveSendKey,
} from './send-keys';
import { siteSendKeys } from '~~/server/db/schema';
import { eq, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Shared FK seed data
// ---------------------------------------------------------------------------
const COMPANY_ID = '10000000-0000-0000-0000-000000000001';
const USER_ID = '20000000-0000-0000-0000-000000000001';

beforeEach(async () => {
  await truncate('site_send_keys', 'companies', 'users');
  // Seed a company and a user so FK constraints are satisfied.
  await db.execute(sql`
    INSERT INTO companies (id, name, status) VALUES (${COMPANY_ID}::uuid, 'Test Co', 'active')
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO users (id, email, password_hash, role, status, must_change_password)
    VALUES (${USER_ID}::uuid, 'sendkey-test@bo.com', 'x', 'operator', 'active', false)
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => { await closeDb(); });

// ---------------------------------------------------------------------------
// Unit: generateSendKey
// ---------------------------------------------------------------------------
describe('generateSendKey', () => {
  it('returns a bo_sk_-prefixed fullKey', () => {
    const { fullKey } = generateSendKey();
    expect(fullKey).toMatch(/^bo_sk_/);
  });

  it('fullKey is at least 32 characters long', () => {
    const { fullKey } = generateSendKey();
    expect(fullKey.length).toBeGreaterThanOrEqual(32);
  });

  it('keyHash is a 64-char hex SHA-256 of fullKey', () => {
    const { fullKey, keyHash } = generateSendKey();
    const expected = createHash('sha256').update(fullKey).digest('hex');
    expect(keyHash).toBe(expected);
    expect(keyHash).toHaveLength(64);
  });

  it('keyPrefix is exactly 12 chars (bo_sk_ + 6 more)', () => {
    const { fullKey, keyPrefix } = generateSendKey();
    expect(keyPrefix).toHaveLength(12);
    expect(fullKey.startsWith(keyPrefix)).toBe(true);
  });

  it('generates unique keys on successive calls', () => {
    const a = generateSendKey();
    const b = generateSendKey();
    expect(a.fullKey).not.toBe(b.fullKey);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

// ---------------------------------------------------------------------------
// Unit: verifySendKey
// ---------------------------------------------------------------------------
describe('verifySendKey', () => {
  it('returns true when the key matches its hash', () => {
    const { fullKey, keyHash } = generateSendKey();
    expect(verifySendKey(fullKey, keyHash)).toBe(true);
  });

  it('returns false for a wrong key against a valid hash', () => {
    const { keyHash } = generateSendKey();
    expect(verifySendKey('bo_sk_wrongkey', keyHash)).toBe(false);
  });

  it('returns false for a tampered hash', () => {
    const { fullKey, keyHash } = generateSendKey();
    const tampered = keyHash.replace(/[0-9]/, (c) => String((Number(c) + 1) % 10));
    expect(verifySendKey(fullKey, tampered)).toBe(false);
  });

  it('returns false for a non-hex hash string without throwing', () => {
    const { fullKey } = generateSendKey();
    expect(verifySendKey(fullKey, 'not-valid-hex!')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration: issueSendKey
// ---------------------------------------------------------------------------
describe('issueSendKey', () => {
  it('stores the hash, not the plaintext key', async () => {
    const { id, fullKey } = await issueSendKey(db, COMPANY_ID, USER_ID, 'test label');
    const [row] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.id, id));
    expect(row).toBeDefined();
    // Hash is stored, not the raw key
    expect(row.keyHash).not.toBe(fullKey);
    // Verify the stored hash matches the key
    const expectedHash = createHash('sha256').update(fullKey).digest('hex');
    expect(row.keyHash).toBe(expectedHash);
  });

  it('returns id, fullKey (bo_sk_-prefixed), keyPrefix, version=1', async () => {
    const result = await issueSendKey(db, COMPANY_ID, USER_ID, 'label');
    expect(result.id).toBeTruthy();
    expect(result.fullKey).toMatch(/^bo_sk_/);
    expect(result.keyPrefix).toHaveLength(12);
    expect(result.version).toBe(1);
  });

  it('stores label and createdBy', async () => {
    const { id } = await issueSendKey(db, COMPANY_ID, USER_ID, 'my-label');
    const [row] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.id, id));
    expect(row.label).toBe('my-label');
    expect(row.createdBy).toBe(USER_ID);
  });

  it('accepts null userId', async () => {
    const { id } = await issueSendKey(db, COMPANY_ID, null, undefined);
    const [row] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.id, id));
    expect(row.createdBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: rotateSendKey
// ---------------------------------------------------------------------------
describe('rotateSendKey', () => {
  it('revokes the old key and issues a successor with version+1', async () => {
    const { id: oldId } = await issueSendKey(db, COMPANY_ID, USER_ID, 'v1');
    const rotated = await rotateSendKey(db, COMPANY_ID, oldId, USER_ID);

    // Old key should be revoked
    const [old] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.id, oldId));
    expect(old.revokedAt).not.toBeNull();

    // New key should have version 2
    expect(rotated.version).toBe(2);
    expect(rotated.fullKey).toMatch(/^bo_sk_/);
    expect(rotated.id).not.toBe(oldId);
  });

  it('carries the label over to the new key', async () => {
    const { id: oldId } = await issueSendKey(db, COMPANY_ID, USER_ID, 'carry-me');
    const { id: newId } = await rotateSendKey(db, COMPANY_ID, oldId, USER_ID);
    const [newRow] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.id, newId));
    expect(newRow.label).toBe('carry-me');
  });

  it('throws 404 if keyId does not belong to the company', async () => {
    const { id } = await issueSendKey(db, COMPANY_ID, USER_ID);
    const OTHER = '10000000-0000-0000-0000-000000000002';
    // Insert another company for the FK
    await db.execute(sql`
      INSERT INTO companies (id, name, status) VALUES (${OTHER}::uuid, 'Other Co', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await expect(rotateSendKey(db, OTHER, id, USER_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 for a completely unknown keyId', async () => {
    const unknownId = '99999999-0000-0000-0000-000000000001';
    await expect(rotateSendKey(db, COMPANY_ID, unknownId, USER_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when rotating an already-revoked key', async () => {
    const { id } = await issueSendKey(db, COMPANY_ID, USER_ID, 'revoked-key');
    await revokeSendKey(db, COMPANY_ID, id);
    await expect(rotateSendKey(db, COMPANY_ID, id, USER_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Integration: revokeSendKey
// ---------------------------------------------------------------------------
describe('revokeSendKey', () => {
  it('marks the key as revoked', async () => {
    const { id } = await issueSendKey(db, COMPANY_ID, USER_ID);
    await revokeSendKey(db, COMPANY_ID, id);
    const [row] = await db.select().from(siteSendKeys).where(eq(siteSendKeys.id, id));
    expect(row.revokedAt).not.toBeNull();
  });

  it('throws 404 when revoking an already-revoked key (idempotency guard)', async () => {
    const { id } = await issueSendKey(db, COMPANY_ID, USER_ID);
    await revokeSendKey(db, COMPANY_ID, id);
    await expect(revokeSendKey(db, COMPANY_ID, id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 for an unknown key', async () => {
    const unknownId = '99999999-0000-0000-0000-000000000002';
    await expect(revokeSendKey(db, COMPANY_ID, unknownId)).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Integration: resolveActiveSendKey
// ---------------------------------------------------------------------------
describe('resolveActiveSendKey', () => {
  it('returns { id, companyId } for an active key', async () => {
    const { id, fullKey } = await issueSendKey(db, COMPANY_ID, USER_ID);
    const resolved = await resolveActiveSendKey(db, fullKey);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(id);
    expect(resolved!.companyId).toBe(COMPANY_ID);
  });

  it('returns null for a revoked key', async () => {
    const { id, fullKey } = await issueSendKey(db, COMPANY_ID, USER_ID);
    await revokeSendKey(db, COMPANY_ID, id);
    const resolved = await resolveActiveSendKey(db, fullKey);
    expect(resolved).toBeNull();
  });

  it('returns null for an unknown key', async () => {
    const resolved = await resolveActiveSendKey(db, 'bo_sk_unknown_key_that_does_not_exist');
    expect(resolved).toBeNull();
  });

  it('returns null for a rotated (revoked) predecessor key', async () => {
    const { id: oldId, fullKey: oldKey } = await issueSendKey(db, COMPANY_ID, USER_ID);
    await rotateSendKey(db, COMPANY_ID, oldId, USER_ID);
    // Old key should not resolve anymore
    const resolved = await resolveActiveSendKey(db, oldKey);
    expect(resolved).toBeNull();
  });
});
