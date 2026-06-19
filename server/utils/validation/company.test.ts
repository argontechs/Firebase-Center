import { describe, it, expect } from 'vitest';
import { parseCompanyCreate, parseCompanyPatch } from './company';

describe('parseCompanyCreate', () => {
  it('accepts a valid name and trims it', () => {
    expect(parseCompanyCreate({ name: '  Acme Corp  ' })).toEqual({ name: 'Acme Corp' });
  });
  it('keeps optional notes', () => {
    expect(parseCompanyCreate({ name: 'Acme', notes: 'vip' })).toEqual({ name: 'Acme', notes: 'vip' });
  });
  it('rejects a missing name with 422', () => {
    expect(() => parseCompanyCreate({})).toThrowError(/422/);
  });
  it('rejects an empty/whitespace name with 422', () => {
    expect(() => parseCompanyCreate({ name: '   ' })).toThrowError(/422/);
  });
});

describe('parseCompanyPatch', () => {
  it('accepts a partial update', () => {
    expect(parseCompanyPatch({ name: 'New' })).toEqual({ name: 'New' });
  });
  it('accepts a valid status', () => {
    expect(parseCompanyPatch({ status: 'archived' })).toEqual({ status: 'archived' });
  });
  it('rejects an unknown status with 422', () => {
    expect(() => parseCompanyPatch({ status: 'deleted' })).toThrowError(/422/);
  });
  it('rejects an empty patch with 422', () => {
    expect(() => parseCompanyPatch({})).toThrowError(/422/);
  });
});
