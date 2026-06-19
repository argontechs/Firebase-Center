import type { H3Event } from 'h3';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const { Pool } = pg;

const connectionString = process.env.NUXT_DATABASE_URL;
if (!connectionString) {
  throw new Error('NUXT_DATABASE_URL is not set');
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

// `client` is the exact binding M2 route code imports; it aliases the shared `db`.
export const client = db;

export type Db = NodePgDatabase<typeof schema>;

// Event-handler shim consumed by M4 (devices ingest / imports). Returns the shared
// process-wide `db`; the `event` arg keeps call sites uniform and leaves room for a
// future request-scoped transaction without changing any caller.
export function useDb(_event: H3Event): Db {
  return db;
}

export { schema };
