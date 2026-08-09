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
  return subcontractor?.certificateRequirement !== 'not_required';
}

export function certificateEligible(subcontractor) {
  return subcontractor?.inactive !== true && certificateRequired(subcontractor);
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
  if (!certificateRequired(subcontractor)) return { id: 'not-required', label: 'No cert needed', days: null };
  if (!certificates.length) return { id: 'missing', label: 'Missing certificate', days: null };
  return certificateStatus(certificates[0].expirationDate, todayIso);
}
