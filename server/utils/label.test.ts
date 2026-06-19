import { describe, it, expect } from 'vitest';
import { LABELS, COMPANY_LABEL, COMPANY_LABEL_PLURAL } from './label';

describe('label constant', () => {
  it('exposes a single configurable company label (singular + plural)', () => {
    expect(LABELS.company.singular).toBe('Company');
    expect(LABELS.company.plural).toBe('Companies');
    expect(LABELS.app.singular).toBe('App');
    expect(LABELS.app.plural).toBe('Apps');
  });

  it('re-exports the company singular/plural as flat constants', () => {
    expect(COMPANY_LABEL).toBe(LABELS.company.singular);
    expect(COMPANY_LABEL_PLURAL).toBe(LABELS.company.plural);
  });

  it('keeps every company label derived from the same singular root (rename-safe)', () => {
    // Renaming LABELS.company.singular must be the ONLY change a rename needs.
    expect(COMPANY_LABEL).toBe(LABELS.company.singular);
    expect(COMPANY_LABEL_PLURAL.startsWith(LABELS.company.singular.replace(/y$/, ''))).toBe(true);
  });
});
