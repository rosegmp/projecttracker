import { is1099ReportingCompanyType, normalizeCompanyType } from './companyType.js';

export const VENDOR_PAYMENT_METHODS = [
  { id: 'check', label: 'Check', necEligible: true },
  { id: 'ach', label: 'ACH', necEligible: true },
  { id: 'cash', label: 'Cash', necEligible: true },
  { id: 'wire', label: 'Wire transfer', necEligible: true },
  { id: 'other_direct', label: 'Other direct payment', necEligible: true },
  { id: 'credit_card', label: 'Credit card', necEligible: false },
  { id: 'third_party_network', label: 'Third-party network', necEligible: false },
];

const PAYMENT_METHOD_BY_ID = new Map(VENDOR_PAYMENT_METHODS.map((method) => [method.id, method]));

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function reportingThresholdForYear(year) {
  const numericYear = Number(year);
  if (numericYear <= 2025) return 600;
  if (numericYear === 2026) return 2000;
  return null;
}

export function normalizeVendorPayments(value) {
  if (!Array.isArray(value)) return [];
  return value.map((payment, index) => ({
    id: String(payment?.id || `payment-${index + 1}`),
    date: String(payment?.date || ''),
    amount: amount(payment?.amount),
    method: PAYMENT_METHOD_BY_ID.has(String(payment?.method || '')) ? String(payment.method) : 'check',
    reference: String(payment?.reference || '').trim(),
    reportable: payment?.reportable !== false,
  })).filter((payment) => payment.date && payment.amount > 0);
}

export function datedPaymentTotal(commitment) {
  return normalizeVendorPayments(commitment?.payments).reduce((sum, payment) => sum + payment.amount, 0);
}

export function legacyUnallocatedPaidAmount(commitment) {
  const explicit = amount(commitment?.legacyPaidAmount);
  if (explicit) return explicit;
  return Math.max(0, amount(commitment?.paidAmount) - datedPaymentTotal(commitment));
}

export function totalPaidAmount(commitment) {
  return datedPaymentTotal(commitment) + legacyUnallocatedPaidAmount(commitment);
}

function paymentYear(date) {
  const match = String(date || '').match(/^(\d{4})-/);
  return match ? Number(match[1]) : 0;
}

function isNecEligiblePayment(payment) {
  return payment.reportable && PAYMENT_METHOD_BY_ID.get(payment.method)?.necEligible === true;
}

export function buildVendor1099Review({ subcontractors = [], documents = [], taxIdStatuses = [], commitments = [], importedVendors = [], paymentSource = 'commitments', year } = {}) {
  const numericYear = Number(year);
  const threshold = reportingThresholdForYear(numericYear);
  const w9Ids = new Set(documents.filter((document) => document.documentType === 'w9').map((document) => String(document.subcontractorId)));
  const taxStatusById = new Map(taxIdStatuses.map((status) => [String(status.subcontractorId), status]));
  const vendorById = new Map(subcontractors.map((vendor) => [String(vendor.id), vendor]));
  const totalsByVendor = new Map();
  const unlinkedCommitments = [];

  if (paymentSource !== 'spreadsheet') commitments.filter((commitment) => commitment.status !== 'void').forEach((commitment) => {
    const vendorId = String(commitment.vendorId || '').trim();
    if (!vendorId || !vendorById.has(vendorId)) {
      if (normalizeVendorPayments(commitment.payments).some((payment) => paymentYear(payment.date) === numericYear)
        || legacyUnallocatedPaidAmount(commitment) > 0) unlinkedCommitments.push(commitment);
      return;
    }
    const summary = totalsByVendor.get(vendorId) || { directTotal: 0, excludedMethodTotal: 0, unallocatedTotal: 0 };
    normalizeVendorPayments(commitment.payments)
      .filter((payment) => paymentYear(payment.date) === numericYear)
      .forEach((payment) => {
        if (!payment.reportable) return;
        if (isNecEligiblePayment(payment)) summary.directTotal += payment.amount;
        else summary.excludedMethodTotal += payment.amount;
      });
    summary.unallocatedTotal += legacyUnallocatedPaidAmount(commitment);
    totalsByVendor.set(vendorId, summary);
  });

  const unmatchedImportedVendors = [];
  if (paymentSource === 'spreadsheet') importedVendors.forEach((vendor) => {
    const vendorId = String(vendor.subcontractorId || '').trim();
    if (!vendorId || !vendorById.has(vendorId)) {
      if (Number(vendor.directTotal) > 0 || Number(vendor.excludedMethodTotal) > 0) unmatchedImportedVendors.push(vendor);
      return;
    }
    const summary = totalsByVendor.get(vendorId) || { directTotal: 0, excludedMethodTotal: 0, unallocatedTotal: 0 };
    summary.directTotal += Math.max(0, Number(vendor.directTotal) || 0);
    summary.excludedMethodTotal += Math.max(0, Number(vendor.excludedMethodTotal) || 0);
    totalsByVendor.set(vendorId, summary);
  });

  const rows = subcontractors.map((vendor) => {
    const vendorId = String(vendor.id || '');
    const taxStatus = taxStatusById.get(vendorId) || null;
    const totals = totalsByVendor.get(vendorId) || { directTotal: 0, excludedMethodTotal: 0, unallocatedTotal: 0 };
    const companyType = normalizeCompanyType(vendor.companyType || taxStatus?.companyType);
    const subjectToReporting = vendor.is1099Exempt !== true && is1099ReportingCompanyType(companyType);
    const reportableAmount = subjectToReporting ? totals.directTotal : 0;
    const issues = [];
    if (!companyType) issues.push('Company type missing');
    if (subjectToReporting && !w9Ids.has(vendorId)) issues.push('W-9 missing');
    if (subjectToReporting && !taxStatus?.taxIdLastFour) issues.push('Tax ID missing');
    if (subjectToReporting && !String(vendor.legalName || taxStatus?.legalName || '').trim()) issues.push('Legal name missing');
    if (subjectToReporting && !String(taxStatus?.mailingAddress || '').trim()) issues.push('Address missing');
    if (totals.unallocatedTotal > 0) issues.push('Undated payments need allocation');

    let status = 'not-reportable';
    let statusLabel = vendor.is1099Exempt === true || (companyType && !is1099ReportingCompanyType(companyType))
      ? 'Not subject to 1099 reporting'
      : 'No reportable payments';
    if (subjectToReporting && reportableAmount > 0) {
      if (threshold == null) {
        status = 'review';
        statusLabel = 'Confirm IRS threshold';
      } else if (reportableAmount < threshold) {
        status = issues.length ? 'needs-attention' : 'below-threshold';
        statusLabel = issues.length ? 'Information incomplete' : 'Below threshold';
      } else if (issues.length) {
        status = 'needs-attention';
        statusLabel = 'Needs information';
      } else {
        status = 'ready';
        statusLabel = 'Ready for preparation';
      }
    } else if (issues.length && (totals.unallocatedTotal > 0 || subjectToReporting)) {
      status = 'needs-attention';
      statusLabel = 'Needs review';
    }

    return {
      id: vendorId,
      displayName: String(vendor.company || `${vendor.first || ''} ${vendor.last || ''}`).trim() || 'Unnamed vendor',
      legalName: String(vendor.legalName || taxStatus?.legalName || '').trim(),
      companyType,
      hasW9: w9Ids.has(vendorId),
      taxIdLastFour: String(taxStatus?.taxIdLastFour || ''),
      mailingAddress: String(taxStatus?.mailingAddress || '').trim(),
      email: String(vendor.email || '').trim().toLowerCase(),
      directTotal: totals.directTotal,
      excludedMethodTotal: totals.excludedMethodTotal,
      unallocatedTotal: totals.unallocatedTotal,
      reportableAmount,
      subjectToReporting,
      issues,
      status,
      statusLabel,
      inactive: vendor.inactive === true,
    };
  }).filter((row) => row.directTotal > 0 || row.excludedMethodTotal > 0 || row.unallocatedTotal > 0 || row.subjectToReporting)
    .sort((a, b) => b.reportableAmount - a.reportableAmount || a.displayName.localeCompare(b.displayName));

  return { year: numericYear, threshold, rows, unlinkedCommitments, unmatchedImportedVendors, paymentSource };
}
