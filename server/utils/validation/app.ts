import { createError } from 'h3';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw createError({ statusCode: 422, message: `422: ${message}`, statusMessage: message });
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function parseAppCreate(body: unknown): { companyId: string; name: string; notes?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const companyId = asString(b.companyId)?.trim();
  if (!companyId || !UUID_RE.test(companyId)) fail('companyId must be a uuid');
  const name = asString(b.name)?.trim();
  if (!name) fail('name is required');
  const out: { companyId: string; name: string; notes?: string } = { companyId: companyId!, name: name! };
  const notes = asString(b.notes)?.trim();
  if (notes) out.notes = notes;
  return out;
}

export function parseAppPatch(body: unknown): { name?: string; notes?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: { name?: string; notes?: string } = {};
  if ('name' in b) {
    const name = asString(b.name)?.trim();
    if (!name) fail('name cannot be empty');
    out.name = name;
  }
  if ('notes' in b) out.notes = asString(b.notes)?.trim() ?? '';
  if (Object.keys(out).length === 0) fail('no updatable fields provided');
  return out;
}
