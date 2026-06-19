import { describe, it, expect } from 'vitest';
import { useLabels } from './useLabels';

describe('useLabels', () => {
  it('exposes the company + app labels from the shared constant', () => {
    const labels = useLabels();
    expect(labels.company.singular).toBe('Company');
    expect(labels.company.plural).toBe('Companies');
    expect(labels.app.singular).toBe('App');
    expect(labels.app.plural).toBe('Apps');
  });
});
