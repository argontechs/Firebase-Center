import { describe, it, expect, beforeEach, afterAll } from 'vitest';
// Set DB URL before anything imports db/client
process.env.NUXT_DATABASE_URL ??= 'postgres://fc:fc@localhost:55432/firebase_center_test';
import { db, resetDb, closeDb } from '~~/server/test/db';
import { runImport } from '../../../server/utils/import/run';
import { companies, apps, imports } from '../../../server/db/schema';
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

describe('runImport', () => {
  it('imports valid rows and routes unroutable rows to failed', async () => {
    // row1 ok; row2 huawei+android = inconsistent (failed); row3 missing token (failed)
    const csv = 'tok,prov,plat\nT1,fcm,android\nT2,huawei,android\n,fcm,ios\n';
    const res = await runImport({
      db, appId, userId: null, filename: 'a.csv', raw: csv, format: 'csv',
      mapping: { token: 'tok', provider: 'prov', platform: 'plat' }, defaults: {},
    });
    expect(res.total).toBe(3);
    expect(res.inserted).toBe(1);
    expect(res.updated).toBe(0);
    expect(res.failed).toBe(2);
    const [imp] = await db.select().from(imports).where(eq(imports.id, res.importId));
    expect(imp.status).toBe('completed');
    expect(imp.totalRows).toBe(3);
    expect(imp.inserted).toBe(1);
    expect(imp.failed).toBe(2);
    expect(imp.filename).toBe('a.csv');
  });
});
