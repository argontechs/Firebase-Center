// Vitest globalSetup — runs ONCE before the whole suite. Applies the committed
// Drizzle migrations to the test database so DB-integration tests always run against
// an up-to-date schema (otherwise a newly-added migration makes the suite fail on a
// stale test DB). Idempotent: drizzle skips already-applied migrations.
import { execSync } from 'node:child_process';

export default async function globalSetup() {
  process.env.NUXT_DATABASE_URL ||= 'postgres://fc:fc@localhost:55432/firebase_center_test';
  execSync('pnpm db:migrate', { stdio: 'inherit', env: process.env });
}
