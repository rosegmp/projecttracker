import {
  deleteProjectFileFromStorage,
  fetchAuthorizedSupabase,
  getStoredAuthSession,
  getSupabaseDiagnosticsInfo,
} from './trackerData.js';

export const CERTIFICATE_FILES_BUCKET = 'certificate-files';
export const CERTIFICATE_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
export const CERTIFICATE_FILE_MAX_BYTES = 15 * 1024 * 1024;

const COVERAGE_ALIASES = new Map([
  ['cgl', 'General Liability'],
  ['commercial general liability', 'General Liability'],
  ['general liability', 'General Liability'],
  ['workers comp', 'Workers Compensation'],
  ['workers compensation', 'Workers Compensation'],
  ['workers compensation employers liability', 'Workers Compensation'],
  ['commercial auto', 'Commercial Auto'],
  ['auto liability', 'Commercial Auto'],
  ['umbrella', 'Umbrella'],
  ['umbrella liability', 'Umbrella'],
  ['excess liability', 'Excess Liability'],
  ['professional liability', 'Professional Liability'],
  ['errors and omissions', 'Professional Liability'],
]);

function cleanText(value) {
  return String(value || '').trim();
}

export function normalizeCoverageType(value) {
  const text = cleanText(value);
  const key = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return '';
  if (/^(workers?|workmans?|workmens?) (comp|compensation)\b/.test(key)) {
    return 'Workers Compensation';
  }
  if (/\bcommercial general liability\b/.test(key) || /^general liability\b/.test(key)) {
    return 'General Liability';
  }
  return COVERAGE_ALIASES.get(key) || text.replace(/\s+/g, ' ');
}

function normalizeCoverage(row = {}, index = 0) {
  return {
    id: cleanText(row.id) || globalThis.crypto?.randomUUID?.() || `coverage-${Date.now()}-${index}`,
    type: normalizeCoverageType(row.coverage_type ?? row.type),
    generalLimit: Number(row.coverage_amount ?? row.generalLimit ?? row.amount) || 0,
    aggregateLimit: Number(row.aggregate_amount ?? row.aggregateLimit) || 0,
    effectiveDate: cleanText(row.effective_date ?? row.effectiveDate),
    expirationDate: cleanText(row.expiration_date ?? row.expirationDate),
    position: Number(row.position ?? index) || 0,
  };
}

export function normalizeInsuranceCertificate(row = {}, coverageRows = row.coverages || []) {
  return {
    id: cleanText(row.id),
    subcontractorId: cleanText(row.subcontractor_id ?? row.subcontractorId),
    holder: cleanText(row.holder),
    insured: cleanText(row.insured),
    insurer: cleanText(row.insurer),
    policyNumber: cleanText(row.policy_number ?? row.policyNumber),
    effectiveDate: cleanText(row.effective_date ?? row.effectiveDate),
    expirationDate: cleanText(row.expiration_date ?? row.expirationDate),
    additionalInsured: Boolean(row.additional_insured ?? row.additionalInsured),
    sourceFileName: cleanText(row.source_file_name ?? row.sourceFileName),
    sourceBucket: cleanText(row.source_bucket ?? row.sourceBucket),
    sourcePath: cleanText(row.source_path ?? row.sourcePath),
    extractionConfidence: cleanText(row.extraction_confidence ?? row.extractionConfidence),
    extractionNotes: cleanText(row.extraction_notes ?? row.extractionNotes),
    version: Number(row.version) || 0,
    createdAt: cleanText(row.created_at ?? row.createdAt),
    updatedAt: cleanText(row.updated_at ?? row.updatedAt),
    coverages: [...coverageRows]
      .map(normalizeCoverage)
      .filter((coverage) => coverage.type)
      .sort((a, b) => a.position - b.position),
  };
}

async function readApiError(response, fallback) {
  const payload = await response.json().catch(() => null);
  const message = cleanText(payload?.message || payload?.error || payload?.hint);
  if (/VERSION_CONFLICT/i.test(message)) {
    throw new Error('VERSION_CONFLICT: This certificate changed after it was opened. Refresh and review the latest copy before retrying.');
  }
  throw new Error(message || fallback);
}

export async function loadInsuranceCertificates() {
  const [certificateResponse, coverageResponse] = await Promise.all([
    fetchAuthorizedSupabase(
      '/rest/v1/insurance_certificates?select=*&order=expiration_date.asc.nullslast,updated_at.desc',
      { method: 'GET' },
      'Insurance certificates',
    ),
    fetchAuthorizedSupabase(
      '/rest/v1/insurance_certificate_coverages?select=*&order=certificate_id.asc,position.asc,id.asc',
      { method: 'GET' },
      'Insurance certificate coverages',
    ),
  ]);

  if (!certificateResponse.ok) {
    await readApiError(certificateResponse, 'Unable to load insurance certificates.');
  }
  if (!coverageResponse.ok) {
    await readApiError(coverageResponse, 'Unable to load certificate coverages.');
  }

  const certificateRows = await certificateResponse.json();
  const coverageRows = await coverageResponse.json();
  const coveragesByCertificate = new Map();
  (Array.isArray(coverageRows) ? coverageRows : []).forEach((row) => {
    const key = cleanText(row.certificate_id);
    if (!coveragesByCertificate.has(key)) coveragesByCertificate.set(key, []);
    coveragesByCertificate.get(key).push(row);
  });

  return (Array.isArray(certificateRows) ? certificateRows : []).map((row) =>
    normalizeInsuranceCertificate(row, coveragesByCertificate.get(cleanText(row.id)) || []));
}

export async function saveInsuranceCertificate(certificate) {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/save_insurance_certificate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_certificate: {
          id: certificate.id,
          subcontractorId: certificate.subcontractorId,
          holder: certificate.holder,
          insured: certificate.insured,
          insurer: certificate.insurer,
          policyNumber: certificate.policyNumber,
          effectiveDate: certificate.effectiveDate,
          expirationDate: certificate.expirationDate,
          additionalInsured: Boolean(certificate.additionalInsured),
          sourceFileName: certificate.sourceFileName,
          sourceBucket: certificate.sourceBucket,
          sourcePath: certificate.sourcePath,
          extractionConfidence: certificate.extractionConfidence,
          extractionNotes: certificate.extractionNotes,
        },
        p_coverages: (certificate.coverages || [])
          .map((coverage, index) => ({
            id: coverage.id,
            type: normalizeCoverageType(coverage.type),
            generalLimit: Number(coverage.generalLimit ?? coverage.amount) || 0,
            aggregateLimit: Number(coverage.aggregateLimit) || 0,
            effectiveDate: cleanText(coverage.effectiveDate),
            expirationDate: cleanText(coverage.expirationDate),
            position: index,
          }))
          .filter((coverage) => coverage.type),
        p_expected_version: certificate.version || null,
      }),
    },
    'Insurance certificate save',
  );
  if (!response.ok) await readApiError(response, 'Unable to save the insurance certificate.');
  return normalizeInsuranceCertificate(await response.json());
}

export async function deleteInsuranceCertificate(certificate) {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/delete_insurance_certificate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_certificate_id: certificate.id,
        p_expected_version: certificate.version,
      }),
    },
    'Insurance certificate delete',
  );
  if (!response.ok) await readApiError(response, 'Unable to delete the insurance certificate.');
  const deleted = await response.json();
  if (deleted?.sourceBucket && deleted?.sourcePath) {
    await deleteProjectFileFromStorage({
      storageBucket: deleted.sourceBucket,
      storagePath: deleted.sourcePath,
    }).catch(() => {});
  }
  return deleted;
}

function safeFileName(name) {
  return (cleanText(name) || 'certificate')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
}

export function validateCertificateFile(file) {
  if (!file) throw new Error('Choose a PDF or image certificate.');
  if (!CERTIFICATE_FILE_TYPES.includes(cleanText(file.type).toLowerCase())) {
    throw new Error('Certificate files must be PDF, JPEG, PNG, or WebP.');
  }
  if (Number(file.size) > CERTIFICATE_FILE_MAX_BYTES) {
    throw new Error('Certificate files must be 15 MB or smaller.');
  }
}

export async function uploadCertificateFile(file) {
  validateCertificateFile(file);
  const session = getStoredAuthSession();
  const userId = cleanText(session?.user?.id);
  const supabaseUrl = cleanText(getSupabaseDiagnosticsInfo().url);
  if (!userId || !supabaseUrl) throw new Error('Your signed-in session is required to upload a certificate.');

  const fileId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storagePath = `certificates/${userId}/${fileId}-${safeFileName(file.name)}`;
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const response = await fetchAuthorizedSupabase(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(CERTIFICATE_FILES_BUCKET)}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'x-upsert': 'false',
      },
      body: file,
    },
    'Certificate upload',
    30000,
  );
  if (!response.ok) await readApiError(response, 'Unable to upload the certificate file.');
  return {
    sourceFileName: safeFileName(file.name),
    sourceBucket: CERTIFICATE_FILES_BUCKET,
    sourcePath: storagePath,
    contentType: file.type,
  };
}

export async function deleteCertificateFile(file) {
  if (!file?.sourceBucket || !file?.sourcePath) return;
  await deleteProjectFileFromStorage({
    storageBucket: file.sourceBucket,
    storagePath: file.sourcePath,
  });
}

export async function extractInsuranceCertificate(file) {
  const response = await fetchAuthorizedSupabase(
    '/functions/v1/extract-insurance-certificate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourcePath: file.sourcePath,
        contentType: file.contentType,
      }),
    },
    'Certificate extraction',
    45000,
  );
  if (!response.ok) await readApiError(response, 'Unable to extract the certificate.');
  const payload = await response.json();
  return {
    subcontractorName: cleanText(payload.subcontractorName),
    holder: cleanText(payload.holder),
    insured: cleanText(payload.insured),
    insurer: cleanText(payload.insurer),
    policyNumber: cleanText(payload.policyNumber),
    effectiveDate: cleanText(payload.effectiveDate),
    expirationDate: cleanText(payload.expirationDate),
    additionalInsured: Boolean(payload.additionalInsured),
    extractionConfidence: ['High', 'Medium', 'Low'].includes(payload.confidence) ? payload.confidence : 'Low',
    extractionNotes: cleanText(payload.extractionNotes),
    coverages: (Array.isArray(payload.coverages) ? payload.coverages : [])
      .map(normalizeCoverage)
      .filter((coverage) => coverage.type),
  };
}
