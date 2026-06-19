import { describe, it, expect, beforeEach, afterAll } from 'vitest';
// server/test/db.ts sets NUXT_DATABASE_URL before importing db/client — import it first.
import { db, resetDb, closeDb } from '~~/server/test/db';
import { issueIngestKey, rotateIngestKey, revokeIngestKey, resolveActiveKey } from '~~/server/utils/ingest-keys';
import { companies, apps, appIngestKeys } from '~~/server/db/schema';
import { eq } from 'drizzle-orm';

let appId: string;

beforeEach(async () => {
  await resetDb();
  const [c] = await db.insert(companies).values({ name: 'Acme' }).returning();
  const [a] = await db.insert(apps).values({ companyId: c.id, name: 'A' }).returning();
  appId = a.id;
});

afterAll(async () => {
  await closeDb();
});

it('issues a key resolvable to its app, then revoke makes it unresolvable', async () => {
  const issued = await issueIngestKey(db, appId, null, 'mobile');
  expect(issued.version).toBe(1);
  expect(await resolveActiveKey(db, issued.fullKey)).toEqual({ id: issued.id, appId });

  await revokeIngestKey(db, appId, issued.id);
  expect(await resolveActiveKey(db, issued.fullKey)).toBeNull();
});

it('rotate revokes the old key and issues version+1', async () => {
  const first = await issueIngestKey(db, appId, null);
  const rotated = await rotateIngestKey(db, appId, first.id, null);

  expect(rotated.version).toBe(2);
  expect(await resolveActiveKey(db, first.fullKey)).toBeNull();           // old revoked
  expect(await resolveActiveKey(db, rotated.fullKey)).toEqual({ id: rotated.id, appId });

  const [oldRow] = await db.select().from(appIngestKeys).where(eq(appIngestKeys.id, first.id));
  expect(oldRow.revokedAt).not.toBeNull();
});
