import { parse as parseCsvSync } from 'csv-parse/sync';

export interface ColumnMapping {
  token: string;                 // source column name for token (required)
  provider?: string;             // source column name for provider (optional => use default)
  platform?: string;             // source column name for platform (optional => use default)
  externalUserId?: string;       // source column name (optional)
  attributes?: string[];         // source columns folded into attributes_jsonb
}

export interface ImportDefaults {
  provider?: string;             // applied when mapping.provider absent or cell empty
  platform?: string;             // applied when mapping.platform absent or cell empty
}

export interface ParsedRow {
  rowNumber: number;             // 1-based source row (header = row 0)
  token: string | null;
  provider: string | null;
  platform: string | null;
  externalUserId: string | null;
  attributes: Record<string, string>;
}

export type ImportFormat = 'csv' | 'json';

function pick(record: Record<string, unknown>, col: string | undefined): string | null {
  if (!col) return null;
  const v = record[col];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toRow(
  record: Record<string, unknown>,
  rowNumber: number,
  mapping: ColumnMapping,
  defaults: ImportDefaults,
): ParsedRow {
  const attributes: Record<string, string> = {};
  for (const col of mapping.attributes ?? []) {
    const val = pick(record, col);
    if (val !== null) attributes[col] = val;
  }
  return {
    rowNumber,
    token: pick(record, mapping.token),
    provider: pick(record, mapping.provider) ?? defaults.provider ?? null,
    platform: pick(record, mapping.platform) ?? defaults.platform ?? null,
    externalUserId: pick(record, mapping.externalUserId),
    attributes,
  };
}

export function parseImport(
  raw: string,
  format: ImportFormat,
  mapping: ColumnMapping,
  defaults: ImportDefaults,
): ParsedRow[] {
  if (format === 'csv') {
    const records: Record<string, unknown>[] = parseCsvSync(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    return records.map((r, i) => toRow(r, i + 1, mapping, defaults));
  }
  // JSON format
  const data = JSON.parse(raw);
  const arr: Record<string, unknown>[] = Array.isArray(data) ? data : [];
  return arr.map((r, i) => toRow(r, i + 1, mapping, defaults));
}
