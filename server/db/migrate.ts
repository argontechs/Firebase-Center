import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

async function run(): Promise<void> {
  await migrate(db, { migrationsFolder: './server/db/migrations' });
  console.log('[migrate] migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(`[migrate] failed: ${err.message}`);
  process.exit(1);
});
