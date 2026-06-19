import { defineEventHandler, setResponseStatus } from 'h3';
import { pool } from '../db/client';

type QueryFn = (sql: string) => Promise<unknown>;

export interface HealthResult {
  statusCode: 200 | 503;
  body: { status: 'ok' | 'error'; db: 'up' | 'down' };
}

// Pure, testable core: probe the DB and map the outcome to a health result.
export async function checkHealth(query: QueryFn): Promise<HealthResult> {
  try {
    await query('SELECT 1');
    return { statusCode: 200, body: { status: 'ok', db: 'up' } };
  } catch {
    return { statusCode: 503, body: { status: 'error', db: 'down' } };
  }
}

export default defineEventHandler(async (event) => {
  const result = await checkHealth((sql) => pool.query(sql));
  setResponseStatus(event, result.statusCode);
  return result.body;
});
