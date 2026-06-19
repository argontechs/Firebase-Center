import { LABELS } from '~~/server/utils/label';

// The label is build-time static (design §4) — no fetch, no store.
// Renaming "Company" anywhere in the UI is a one-line change in server/utils/label.ts.
export function useLabels() {
  return LABELS;
}
