import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { closeDb } from '../test/db';

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ allowedOrigins: ['http://localhost:3000'] }) }), { virtual: true });
vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  createError: (o: any) => Object.assign(new Error(o.statusMessage ?? 'err'), o),
}));

import labelsGet from './labels.get';

afterAll(async () => { await closeDb(); });

describe('GET /api/labels', () => {
  it('returns the label config without requiring auth', async () => {
    const res = await labelsGet({} as any);
    expect(res).toEqual({
      company: { singular: 'Site', plural: 'Sites' },
      app: { singular: 'App', plural: 'Apps' },
    });
  });
});
