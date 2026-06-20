/**
 * Unit tests for db-errors helpers (F9 fix).
 *
 * These are pure-function tests — no DB connection needed.
 */
import { describe, it, expect } from 'vitest';
import { isUniqueViolation, isFkViolation } from './db-errors';

describe('isUniqueViolation', () => {
  it('returns true for pg error code 23505', () => {
    expect(isUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(true);
  });

  it('returns true for an error whose message contains "duplicate key"', () => {
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "companies_name_unique"' })).toBe(true);
  });

  it('returns true for an error whose message contains "unique" (case-insensitive)', () => {
    expect(isUniqueViolation({ message: 'UNIQUE constraint failed' })).toBe(true);
  });

  it('returns false for a generic non-unique error', () => {
    expect(isUniqueViolation({ code: '42P01', message: 'relation "foo" does not exist' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isUniqueViolation('some string')).toBe(false);
  });
});

describe('isFkViolation', () => {
  it('returns true for pg error code 23503', () => {
    expect(isFkViolation({ code: '23503', message: 'update or delete on table "companies" violates foreign key constraint' })).toBe(true);
  });

  it('returns true for an error whose message contains "foreign key"', () => {
    expect(isFkViolation({ message: 'insert or update on table "apps" violates foreign key constraint "apps_company_id_companies_id_fk"' })).toBe(true);
  });

  it('returns false for a unique-violation error', () => {
    expect(isFkViolation({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFkViolation(null)).toBe(false);
  });

  it('returns false for a plain number', () => {
    expect(isFkViolation(42)).toBe(false);
  });
});
