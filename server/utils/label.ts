// SINGLE SOURCE OF TRUTH for the user-facing tenant label.
// Renaming "Company" -> "Client" / "Site" / "Brand" later is cosmetic:
// change the two strings below and nothing else (no data migration — design §4).
export const LABELS = {
  company: { singular: 'Company', plural: 'Companies' },
  app: { singular: 'App', plural: 'Apps' },
} as const;

export const COMPANY_LABEL = LABELS.company.singular;
export const COMPANY_LABEL_PLURAL = LABELS.company.plural;
