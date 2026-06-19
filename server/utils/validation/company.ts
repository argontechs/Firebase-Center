import { createError } from 'h3';

function fail(message: string): never {
  throw createError({ statusCode: 422, message: `422: ${message}`, statusMessage: message });
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function parseCompanyCreate(body: unknown): { name: string; notes?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = asString(b.name)?.trim();
  if (!name) fail('name is required');
  const out: { name: string; notes?: string } = { name: name! };
  const notes = asString(b.notes)?.trim();
  if (notes) out.notes = notes;
  return out;
}

export function parseCompanyPatch(body: unknown): {
  name?: string; notes?: string; status?: 'active' | 'archived';
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: { name?: string; notes?: string; status?: 'active' | 'archived' } = {};
  if ('name' in b) {
    const name = asString(b.name)?.trim();
    if (!name) fail('name cannot be empty');
    out.name = name;
  }
  if ('notes' in b) out.notes = asString(b.notes)?.trim() ?? '';
  if ('status' in b) {
    const status = asString(b.status);
    if (status !== 'active' && status !== 'archived') fail('status must be active|archived');
    out.status = status;
  }
  if (Object.keys(out).length === 0) fail('no updatable fields provided');
  return out;
}
