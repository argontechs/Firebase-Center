import { describe, it, expect } from 'vitest';
import { parseAppCreate, parseAppPatch } from './app';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('parseAppCreate', () => {
  it('accepts a valid company id + name', () => {
    expect(parseAppCreate({ companyId: UUID, name: '  Shopper ' })).toEqual({ companyId: UUID, name: 'Shopper' });
  });
  it('keeps optional notes', () => {
    expect(parseAppCreate({ companyId: UUID, name: 'Rider', notes: 'n' })).toEqual({ companyId: UUID, name: 'Rider', notes: 'n' });
  });
  it('rejects a missing name with 422', () => {
    expect(() => parseAppCreate({ companyId: UUID })).toThrowError(/422/);
  });
  it('rejects a non-uuid companyId with 422', () => {
    expect(() => parseAppCreate({ companyId: 'nope', name: 'X' })).toThrowError(/422/);
  });
});

describe('parseAppPatch', () => {
  it('accepts a name-only patch', () => {
    expect(parseAppPatch({ name: 'New' })).toEqual({ name: 'New' });
  });
  it('rejects an empty patch with 422', () => {
    expect(() => parseAppPatch({})).toThrowError(/422/);
  });
});
