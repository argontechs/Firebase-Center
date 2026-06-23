import { readMigrationFiles } from 'drizzle-orm/migrator';
import { pool } from './client';

// Custom runner: applies each migration file with its own connection (not a single wrapping transaction).
// This is needed because ALTER TYPE ADD VALUE cannot be used in a transaction where the new value
// is referenced in the same transaction (e.g., in a partial index).
async function run(): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: './server/db/migrations' });

  const client = await pool.connect();
  try {
    // Ensure migrations schema + table exist
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const { rows: [lastRow] } = await client.query(
      `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`
    );

    for (const migration of migrations) {
      if (lastRow && Number(lastRow.created_at) >= migration.folderMillis) {
        continue;
      }

      // Apply each statement from the migration file sequentially WITHOUT a wrapping transaction.
      // This allows ALTER TYPE ADD VALUE to commit immediately before being referenced in later statements.
      for (const stmt of migration.sql) {
        await client.query(stmt);
      }
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [migration.hash, migration.folderMillis]
      );

      console.log(`[migrate] applied: ${migration.hash.slice(0, 8)}...`);
    }
  } finally {
    client.release();
  }

  console.log('[migrate] migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(`[migrate] failed: ${err.message}`);
  process.exit(1);
});
