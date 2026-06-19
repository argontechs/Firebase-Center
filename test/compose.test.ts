import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const compose = parse(readFileSync(`${root}docker-compose.yml`, 'utf8'));

describe('docker-compose.yml', () => {
  it('defines app and db services', () => {
    expect(compose.services.app).toBeTruthy();
    expect(compose.services.db).toBeTruthy();
  });

  it('uses a named volume for the db', () => {
    expect(compose.volumes).toBeTruthy();
    const volNames = Object.keys(compose.volumes);
    expect(volNames.length).toBeGreaterThan(0);
    const dbVols: string[] = compose.services.db.volumes ?? [];
    expect(dbVols.some((v) => volNames.some((n) => v.startsWith(`${n}:`)))).toBe(true);
  });

  it('both services restart unless-stopped', () => {
    expect(compose.services.app.restart).toBe('unless-stopped');
    expect(compose.services.db.restart).toBe('unless-stopped');
  });

  it('db has a healthcheck and app waits for it', () => {
    expect(compose.services.db.healthcheck).toBeTruthy();
    expect(compose.services.app.depends_on.db.condition).toBe('service_healthy');
  });
});
