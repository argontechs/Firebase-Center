import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { imports } from '~~/server/db/schema';
import type { schema } from '~~/server/db/client';
import { audit } from '~~/server/utils/audit';
import { parseImport, type ColumnMapping, type ImportDefaults, type ImportFormat } from './parse';
import { validateRows } from './validate';
import { upsertDevices } from './upsert';

export type { ColumnMapping, ImportDefaults, ImportFormat };

export type Db = NodePgDatabase<typeof schema>;

export interface RunImportInput {
  db: Db;
  appId: string;
  userId: string | null;
  filename: string;
  raw: string;
  format: ImportFormat;
  mapping: ColumnMapping;
  defaults: ImportDefaults;
}

export interface RunImportResult {
  importId: string;
  total: number;
  inserted: number;
  updated: number;
  failed: number;
}

export async function runImport(input: RunImportInput): Promise<RunImportResult> {
  const { db, appId, userId, filename, raw, format, mapping, defaults } = input;

  // Create the imports row in 'processing' state.
  const [imp] = await db
    .insert(imports)
    .values({ appId, filename, createdBy: userId, status: 'processing' })
    .returning();

  try {
    const parsed = parseImport(raw, format, mapping, defaults);
    const { valid, rejected } = validateRows(parsed);
    const { inserted, updated } = await upsertDevices(db, appId, valid);
    const failed = rejected.length;
    const total = parsed.length;

    await db
      .update(imports)
      .set({ totalRows: total, inserted, updated, failed, status: 'completed' })
      .where(eq(imports.id, imp.id));

    await audit({
      userId,
      action: 'import_run',
      targetType: 'app',
      targetId: appId,
      meta: { importId: imp.id, total, inserted, updated, failed },
    });

    return { importId: imp.id, total, inserted, updated, failed };
  } catch (err) {
    await db.update(imports).set({ status: 'failed' }).where(eq(imports.id, imp.id));
    throw err;
  }
}
