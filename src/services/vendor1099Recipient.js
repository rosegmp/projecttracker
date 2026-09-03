const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = (import.meta.env?.VITE_SUPABASE_KEY || '').trim();
const TOKEN_STORAGE_KEY = 'project-tracker:1099-recipient-token';

async function publicRequest(action, token, payload = {}, responseType = 'json') {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Project Hub tax-document delivery is not configured.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-vendor-1099`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...payload }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(String(body?.error || 'Unable to open the secure tax document.'));
  }
  return responseType === 'blob' ? response.blob() : response.json();
}

export function consumeVendor1099RecipientToken() {
  if (typeof window === 'undefined') return '';
  const match = window.location.hash.match(/^#tax-document=([A-Za-z0-9_-]{40,160})$/);
  if (match) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, match[1]);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    return match[1];
  }
  if (window.location.hash) return '';
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function clearVendor1099RecipientToken() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function loadVendor1099RecipientRequest(token) {
  return publicRequest('recipient-load', token);
}

export function downloadVendor1099ConsentSample(token) {
  return publicRequest('recipient-sample', token, {}, 'blob');
}

export function consentToVendor1099ElectronicDelivery(token, signerName, signerEmail) {
  return publicRequest('recipient-consent', token, { signerName, signerEmail });
}

export function downloadVendor1099RecipientPdf(token) {
  return publicRequest('recipient-download', token, {}, 'blob');
}

export function withdrawVendor1099ElectronicConsent(token) {
  return publicRequest('recipient-withdraw', token);
}
