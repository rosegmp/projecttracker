import { fetchAuthorizedSupabase } from './trackerData.js';

async function responseJson(response, fallback) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(body?.message || body?.error || fallback));
  return body;
}

function normalizeRow(row) {
  return {
    id: String(row?.id || ''),
    sourceRow: Number(row?.position) + 1,
    vendorName: String(row?.vendor_name || ''),
    taxIdLastFour: String(row?.tax_id_last_four || ''),
    reportableTotal: Number(row?.reportable_total) || 0,
    subcontractorId: String(row?.subcontractor_id || ''),
    sourceFileName: String(row?.source_file_name || ''),
    importedAt: String(row?.imported_at || ''),
  };
}

export async function loadVendor1099Import(year) {
  const response = await fetchAuthorizedSupabase(`/rest/v1/vendor_1099_import_rows?tax_year=eq.${encodeURIComponent(year)}&select=*&order=position.asc`, { method: 'GET' }, '1099 import');
  return (await responseJson(response, 'Unable to load the 1099 spreadsheet import.')).map(normalizeRow);
}

export async function replaceVendor1099Import(year, fileName, rows) {
  const response = await fetchAuthorizedSupabase('/rest/v1/rpc/replace_vendor_1099_import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_tax_year: year,
      p_source_file_name: String(fileName || '').slice(0, 240),
      p_rows: rows.map((row) => ({
        vendor_name: row.vendorName,
        tax_id_last_four: row.taxIdLastFour,
        reportable_total: Number(row.reportableTotal).toFixed(2),
        subcontractor_id: row.subcontractorId || '',
      })),
    }),
  }, '1099 spreadsheet import', 30000);
  return (await responseJson(response, 'Unable to save the 1099 spreadsheet import.')).map(normalizeRow);
}

export async function setVendor1099ImportMatch(importRowId, subcontractorId) {
  const response = await fetchAuthorizedSupabase('/rest/v1/rpc/set_vendor_1099_import_match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_import_row_id: importRowId, p_subcontractor_id: subcontractorId || '' }),
  }, '1099 vendor match');
  return normalizeRow(await responseJson(response, 'Unable to save the 1099 vendor match.'));
}
