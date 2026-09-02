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
