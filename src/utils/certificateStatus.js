import { is1099ReportingCompanyType, normalizeCompanyType } from './companyType.js';

function cleanText(value) {
  return String(value || '').trim();
}

function localIsoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoDayNumber(value) {
  const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

export function subcontractorLabel(subcontractor) {
  const name = `${subcontractor?.first || ''} ${subcontractor?.last || ''}`.trim();
  return cleanText(subcontractor?.company || name || 'Unnamed subcontractor');
}

export function certificateStatus(expirationDate, todayIso = localIsoDate()) {
  const expirationDay = isoDayNumber(expirationDate);
  const todayDay = isoDayNumber(todayIso);
  if (expirationDay === null || todayDay === null) {
    return { id: 'missing', label: 'Missing expiration', days: null };
  }
  const days = expirationDay - todayDay;
  if (days < 0) return { id: 'expired', label: 'Expired', days };
  if (days <= 30) return { id: 'expiring', label: 'Expiring soon', days };
  return { id: 'active', label: 'Active', days };
}

export function certificateMatchesStatusFilter(statusId, filterId = 'all') {
  if (filterId === 'all') return true;
  if (filterId === 'expired-expiring') return statusId === 'expired' || statusId === 'expiring';
  return statusId === filterId;
}

export function certificateRequired(subcontractor) {
  return subcontractor?.inactive !== true;
}

export function certificateEligible(subcontractor) {
  return subcontractor?.inactive !== true;
}

function normalizedCoverageType(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coverageMatches(value, patterns) {
  const normalized = normalizedCoverageType(value);
  return patterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

export function requiredInsuranceCoverageStatus(certificates = [], coverageType, todayIso = localIsoDate()) {
  const patterns = coverageType === 'workers_compensation'
    ? ['workers compensation', 'workmans compensation', 'workmens compensation']
    : ['general liability', 'commercial general liability'];
  const candidates = [];
  (certificates || []).forEach((certificate) => {
    (certificate?.coverages || []).forEach((coverage) => {
      if (!coverageMatches(coverage.type, patterns)) return;
      candidates.push({
        effectiveDate: coverage.effectiveDate || certificate.effectiveDate || '',
        expirationDate: coverage.expirationDate || certificate.expirationDate || '',
        certificate,
        coverage,
      });
    });
  });
  candidates.sort((left, right) => String(right.expirationDate || '').localeCompare(String(left.expirationDate || '')));
  const todayDay = isoDayNumber(todayIso);
  const currentlyEffective = candidates.filter((candidate) => {
    const effectiveDay = isoDayNumber(candidate.effectiveDate);
    return effectiveDay === null || todayDay === null || effectiveDay <= todayDay;
  });
  const current = currentlyEffective[0] || candidates[0] || null;
  const currentEffectiveDay = isoDayNumber(current?.effectiveDate);
  const notYetEffective = currentEffectiveDay !== null && todayDay !== null && currentEffectiveDay > todayDay;
  return {
    id: coverageType,
    label: coverageType === 'workers_compensation' ? 'Workers Compensation' : 'General Liability',
    status: current
      ? notYetEffective
        ? { id: 'pending', label: 'Not yet effective', days: currentEffectiveDay - todayDay }
        : certificateStatus(current.expirationDate, todayIso)
      : { id: 'missing', label: 'Missing', days: null },
    effectiveDate: current?.effectiveDate || '',
    expirationDate: current?.expirationDate || '',
    certificateId: current?.certificate?.id || '',
  };
}

export function subcontractorComplianceStatus(
  subcontractor,
  certificates = [],
  documents = [],
  todayIso = localIsoDate(),
) {
  if (subcontractor?.inactive === true) {
    return { id: 'inactive', label: 'Inactive', missing: [], requirements: [] };
  }
  const generalLiability = requiredInsuranceCoverageStatus(certificates, 'general_liability', todayIso);
  const workersCompensation = requiredInsuranceCoverageStatus(certificates, 'workers_compensation', todayIso);
  const agreement = (documents || []).find((document) =>
    document.documentType === 'subcontractor_agreement' && document.sourcePath);
  const w9 = (documents || []).find((document) =>
    document.documentType === 'w9' && document.sourcePath);
  const companyType = normalizeCompanyType(subcontractor?.companyType);
  const w9Exempt = companyType
    ? !is1099ReportingCompanyType(companyType)
    : subcontractor?.is1099Exempt === true;
  const requirements = [
    { id: 'general_liability', label: 'Current General Liability', satisfied: ['active', 'expiring'].includes(generalLiability.status.id), detail: generalLiability.status.label },
    { id: 'workers_compensation', label: 'Workers Compensation', satisfied: true, optional: true, detail: workersCompensation.status.label },
    { id: 'subcontractor_agreement', label: 'Signed subcontractor agreement', satisfied: Boolean(agreement), detail: agreement ? 'On file' : 'Missing' },
    { id: 'w9', label: 'Signed Form W-9', satisfied: w9Exempt || Boolean(w9), detail: w9Exempt ? 'Not subject to 1099 reporting' : w9 ? 'On file' : 'Missing' },
  ];
  const missing = requirements.filter((requirement) => !requirement.satisfied);
  return {
    id: missing.length ? 'needs-attention' : 'compliant',
    label: missing.length ? `Needs attention · ${missing.length}` : 'Compliant',
    missing,
    requirements,
    generalLiability,
    workersCompensation,
  };
}

export function sortCertificatesByExpiration(certificates = []) {
  return [...certificates].sort((left, right) => {
    const leftDay = isoDayNumber(left?.expirationDate) ?? Number.NEGATIVE_INFINITY;
    const rightDay = isoDayNumber(right?.expirationDate) ?? Number.NEGATIVE_INFINITY;
    return rightDay - leftDay;
  });
}

export function subcontractorCertificateStatus(subcontractor, certificates = [], todayIso = localIsoDate()) {
  if (subcontractor?.inactive === true) return { id: 'inactive', label: 'Inactive', days: null };
  if (!certificates.length) return { id: 'missing', label: 'Missing certificate', days: null };
  return certificateStatus(certificates[0].expirationDate, todayIso);
}
