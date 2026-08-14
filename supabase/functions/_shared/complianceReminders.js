export const COMPLIANCE_REMINDER_DAYS = Object.freeze([60, 30, 14, 7]);
export const COMPLIANCE_FOLLOWUP_DAYS = Object.freeze([7, 14, 30]);

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizedCoverageType(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  return normalized.includes('generalliability') || normalized.includes('commercialgeneralliability')
    ? 'general_liability'
    : '';
}

function validDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function utcDayDifference(later, earlier) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

function datePart(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function is1099ReportingCompanyType(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized === 'individual sole proprietor or single member llc'
    || normalized === 'limited liability company'
    || normalized.startsWith('limited liability company ')
    || normalized === 'llc';
}

function currentGeneralLiabilityBySubcontractor(today, certificates, coverages) {
  const certificateMap = new Map(certificates.map((row) => [String(row.id), row]));
  const status = new Map();
  coverages.forEach((coverage) => {
    if (normalizedCoverageType(coverage.coverage_type) !== 'general_liability') return;
    const certificate = certificateMap.get(String(coverage.certificate_id));
    if (!certificate) return;
    const subcontractorId = String(certificate.subcontractor_id || '');
    const effectiveDate = validDate(coverage.effective_date || certificate.effective_date);
    const expirationDate = validDate(coverage.expiration_date || certificate.expiration_date);
    if (!expirationDate) return;
    const current = status.get(subcontractorId) || { isCurrent: false, latestExpirationDate: '' };
    current.latestExpirationDate = [current.latestExpirationDate, expirationDate].sort().at(-1) || '';
    if ((!effectiveDate || effectiveDate <= today) && expirationDate >= today) current.isCurrent = true;
    status.set(subcontractorId, current);
  });
  return status;
}

export function buildScheduledComplianceReminderCandidates({
  today,
  subcontractors = [],
  certificates = [],
  coverages = [],
}) {
  if (!validDate(today)) throw new Error('A valid reminder processing date is required.');
  const subcontractorMap = new Map(subcontractors.map((row) => [String(row.id), row.data || {}]));
  const certificateMap = new Map(certificates.map((row) => [String(row.id), row]));
  const latestCoverage = new Map();

  coverages.forEach((coverage) => {
    if (normalizedCoverageType(coverage.coverage_type) !== 'general_liability') return;
    const certificate = certificateMap.get(String(coverage.certificate_id));
    if (!certificate) return;
    const expirationDate = validDate(coverage.expiration_date || certificate.expiration_date);
    const effectiveDate = validDate(coverage.effective_date || certificate.effective_date);
    if (!expirationDate || expirationDate < today || (effectiveDate && effectiveDate > expirationDate)) return;
    const subcontractorId = String(certificate.subcontractor_id || '');
    const current = latestCoverage.get(subcontractorId);
    if (!current || expirationDate > current.expirationDate) latestCoverage.set(subcontractorId, { coverage, certificate, expirationDate });
  });

  const candidates = [];
  latestCoverage.forEach(({ coverage, certificate, expirationDate }, subcontractorId) => {
    const days = utcDayDifference(expirationDate, today);
    const reminderDays = COMPLIANCE_REMINDER_DAYS.filter((checkpoint) => days <= checkpoint).at(-1);
    if (!reminderDays) return;
    const subcontractor = subcontractorMap.get(subcontractorId);
    if (!subcontractor || subcontractor.inactive === true) return;
    const recipientEmail = cleanEmail(subcontractor.email);
    if (!recipientEmail) return;
    candidates.push({
      subcontractorId,
      subcontractorName: String(subcontractor.company || `${subcontractor.first || ''} ${subcontractor.last || ''}`).trim() || 'Subcontractor',
      recipientEmail,
      certificateId: String(certificate.id),
      coverageId: String(coverage.id),
      expirationDate,
      reminderDays,
    });
  });
  return candidates.sort((left, right) => left.expirationDate.localeCompare(right.expirationDate)
    || left.subcontractorName.localeCompare(right.subcontractorName));
}

export function buildScheduledComplianceFollowupCandidates({
  today,
  subcontractors = [],
  certificates = [],
  coverages = [],
  documents = [],
}) {
  if (!validDate(today)) throw new Error('A valid reminder processing date is required.');
  const documentsBySubcontractor = new Map();
  documents.forEach((document) => {
    if (!String(document.source_path || '').trim()) return;
    const subcontractorId = String(document.subcontractor_id || '');
    if (!documentsBySubcontractor.has(subcontractorId)) documentsBySubcontractor.set(subcontractorId, new Set());
    documentsBySubcontractor.get(subcontractorId).add(String(document.document_type || ''));
  });
  const coverageStatus = currentGeneralLiabilityBySubcontractor(today, certificates, coverages);
  const candidates = [];

  subcontractors.forEach((row) => {
    const subcontractorId = String(row.id || '');
    const subcontractor = row.data || {};
    const recipientEmail = cleanEmail(subcontractor.email);
    const requestedAt = String(subcontractor.complianceRequestedAt || '').trim();
    const requestedDate = datePart(requestedAt);
    const requestedRequirements = Array.isArray(subcontractor.complianceRequestedRequirements)
      ? [...new Set(subcontractor.complianceRequestedRequirements.map((value) => String(value || '').trim()))]
      : [];
    if (subcontractor.inactive === true || !recipientEmail || !requestedDate || !requestedRequirements.length) return;
    const elapsedDays = utcDayDifference(today, requestedDate);
    const reminderDays = COMPLIANCE_FOLLOWUP_DAYS.filter((checkpoint) => checkpoint <= elapsedDays).at(-1);
    if (!reminderDays) return;

    const documentTypes = documentsBySubcontractor.get(subcontractorId) || new Set();
    const generalLiability = coverageStatus.get(subcontractorId) || { isCurrent: false, latestExpirationDate: '' };
    const companyType = String(subcontractor.companyType || '').trim();
    const w9Required = companyType ? is1099ReportingCompanyType(companyType) : subcontractor.is1099Exempt !== true;
    const missing = requestedRequirements.filter((requirement) => {
      if (requirement === 'general_liability') return !generalLiability.isCurrent;
      if (requirement === 'subcontractor_agreement') return !documentTypes.has('subcontractor_agreement');
      if (requirement === 'w9') return w9Required && !documentTypes.has('w9');
      return false;
    });
    if (!missing.length) return;
    candidates.push({
      subcontractorId,
      subcontractorName: String(subcontractor.company || `${subcontractor.first || ''} ${subcontractor.last || ''}`).trim() || 'Subcontractor',
      recipientEmail,
      requestedAt,
      requestedDate,
      reminderDays,
      missing,
      latestExpirationDate: generalLiability.latestExpirationDate,
    });
  });

  return candidates.sort((left, right) => left.requestedDate.localeCompare(right.requestedDate)
    || left.subcontractorName.localeCompare(right.subcontractorName));
}
