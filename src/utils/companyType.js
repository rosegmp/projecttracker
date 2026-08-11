export const W9_COMPANY_TYPES = [
  'Individual/sole proprietor or single-member LLC',
  'C Corporation',
  'S Corporation',
  'Partnership',
  'Trust/estate',
  'Limited Liability Company',
  'Other',
];

const COMPANY_TYPE_ALIASES = new Map([
  ['individual', W9_COMPANY_TYPES[0]],
  ['sole proprietor', W9_COMPANY_TYPES[0]],
  ['single member llc', W9_COMPANY_TYPES[0]],
  ['individual sole proprietor or single member llc', W9_COMPANY_TYPES[0]],
  ['c corporation', W9_COMPANY_TYPES[1]],
  ['c corp', W9_COMPANY_TYPES[1]],
  ['s corporation', W9_COMPANY_TYPES[2]],
  ['s corp', W9_COMPANY_TYPES[2]],
  ['partnership', W9_COMPANY_TYPES[3]],
  ['trust estate', W9_COMPANY_TYPES[4]],
  ['limited liability company', W9_COMPANY_TYPES[5]],
  ['llc', W9_COMPANY_TYPES[5]],
  ['other', W9_COMPANY_TYPES[6]],
]);

function companyTypeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCompanyType(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const key = companyTypeKey(text);
  if (key.startsWith('limited liability company') || /^llc\b/.test(key)) return W9_COMPANY_TYPES[5];
  return COMPANY_TYPE_ALIASES.get(key) || W9_COMPANY_TYPES[6];
}

export function is1099ReportingCompanyType(value) {
  const companyType = normalizeCompanyType(value);
  return companyType === W9_COMPANY_TYPES[0] || companyType === W9_COMPANY_TYPES[5];
}
