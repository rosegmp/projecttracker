import { fetchAuthorizedSupabase } from './trackerData.js';

async function request(action, payload = {}) {
  const response = await fetchAuthorizedSupabase('/functions/v1/manage-vendor-1099', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  }, '1099 filing workspace', 45000);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(body?.error || body?.message || 'Unable to manage the 1099 filing workspace.'));
  return body;
}

export function loadVendor1099FilingWorkspace() {
  return request('get-workspace');
}

export function saveVendor1099PayerProfile(profile) {
  return request('save-payer', profile);
}

export function createVendor1099FilingBatch(taxYear, rows) {
  return request('create-batch', {
    taxYear,
    rows: rows.map((row) => ({ subcontractorId: row.id, compensation: row.reportableAmount })),
  });
}

export function requestVendor1099ElectronicConsent(formId) {
  return request('request-consent', { formId });
}

export async function uploadVendor1099RecipientPdf(formId, file) {
  if (!(file instanceof File) || file.type !== 'application/pdf' || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose a PDF recipient copy no larger than 10 MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return request('upload-recipient-pdf', { formId, fileName: file.name, contentBase64: btoa(binary) });
}

export function sendVendor1099RecipientCopy(formId) {
  return request('send-recipient-copy', { formId });
}

export function updateVendor1099FilingStatus(batchId, jurisdiction, status, confirmation = '') {
  return request('update-filing-status', { batchId, jurisdiction, status, confirmation });
}

export async function downloadVendor1099PreparationCsv(batchId, jurisdiction) {
  const response = await fetchAuthorizedSupabase('/functions/v1/manage-vendor-1099', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'download-preparation-export', batchId, jurisdiction }),
  }, '1099 preparation export', 45000);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(String(body?.error || 'Unable to prepare the 1099 export.'));
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const fileName = disposition.match(/filename="([^"]+)"/i)?.[1] || `1099-${jurisdiction}-preparation.csv`;
  return { blob: await response.blob(), fileName };
}
