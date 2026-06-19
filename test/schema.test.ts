import { describe, it, expect } from 'vitest';
import * as schema from '../server/db/schema';
import { getTableName, getTableColumns } from 'drizzle-orm';

describe('schema', () => {
  it('exports all canonical tables with the expected SQL names', () => {
    const expected: Record<string, string> = {
      users: 'users',
      companies: 'companies',
      apps: 'apps',
      appCredentials: 'app_credentials',
      appIngestKeys: 'app_ingest_keys',
      devices: 'devices',
      imports: 'imports',
      campaigns: 'campaigns',
      deliveries: 'deliveries',
      jobs: 'jobs',
      auditLog: 'audit_log',
    };
    for (const [exportName, sqlName] of Object.entries(expected)) {
      const table = (schema as Record<string, unknown>)[exportName];
      expect(table, `export ${exportName} missing`).toBeTruthy();
      expect(getTableName(table as never)).toBe(sqlName);
    }
  });

  it('devices.provider and devices.platform are NOT NULL', () => {
    const cols = getTableColumns(schema.devices);
    expect(cols.provider.notNull).toBe(true);
    expect(cols.platform.notNull).toBe(true);
  });

  it('campaigns.targetType column exists (enum target_type)', () => {
    const cols = getTableColumns(schema.campaigns);
    expect(cols.targetType.notNull).toBe(true);
  });
});
