import {
  deleteProjectFileFromStorage,
  fetchAuthorizedSupabase,
  getStoredAuthSession,
  getSupabaseDiagnosticsInfo,
} from './trackerData.js';
import { trackerQueryClient } from './queryClient.js';

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

export function normalizeCertificateRenewalRequest(row = {}) {
  return {
    id: cleanText(row.id),
    subcontractorId: cleanText(row.subcontractor_id ?? row.subcontractorId),
    sourceCertificateId: cleanText(row.source_certificate_id ?? row.sourceCertificateId),
    receivedCertificateId: cleanText(row.received_certificate_id ?? row.receivedCertificateId),
    status: cleanText(row.status) || 'requested',
    recipientEmail: cleanText(row.recipient_email ?? row.recipientEmail),
    requestedByName: cleanText(row.requested_by_name ?? row.requestedByName),
    requestedByEmail: cleanText(row.requested_by_email ?? row.requestedByEmail),
    deliveryStatus: cleanText(row.delivery_status ?? row.deliveryStatus) || 'pending',
    requestedAt: cleanText(row.requested_at ?? row.requestedAt),
    deliveredAt: cleanText(row.delivered_at ?? row.deliveredAt),
    receivedAt: cleanText(row.received_at ?? row.receivedAt),
    reviewedAt: cleanText(row.reviewed_at ?? row.reviewedAt),
    acceptedAt: cleanText(row.accepted_at ?? row.acceptedAt),
    version: Number(row.version) || 0,
  };
}

export function normalizeSubcontractorComplianceDocument(row = {}) {
  return {
    id: cleanText(row.id),
    subcontractorId: cleanText(row.subcontractor_id ?? row.subcontractorId),
    documentType: cleanText(row.document_type ?? row.documentType),
    signedDate: cleanText(row.signed_date ?? row.signedDate),
    sourceFileName: cleanText(row.source_file_name ?? row.sourceFileName),
    sourceBucket: cleanText(row.source_bucket ?? row.sourceBucket),
    sourcePath: cleanText(row.source_path ?? row.sourcePath),
    version: Number(row.version) || 0,
    createdAt: cleanText(row.created_at ?? row.createdAt),
    updatedAt: cleanText(row.updated_at ?? row.updatedAt),
  };
}

export function normalizeSubcontractorTaxIdStatus(row = {}) {
  const lastFour = cleanText(row.tax_id_last_four ?? row.taxIdLastFour).replace(/\D/g, '').slice(-4);
  return {
    subcontractorId: cleanText(row.subcontractor_id ?? row.subcontractorId),
    taxIdLastFour: lastFour.length === 4 ? lastFour : '',
    taxIdType: ['ein', 'ssn'].includes(cleanText(row.tax_id_type ?? row.taxIdType).toLowerCase())
      ? cleanText(row.tax_id_type ?? row.taxIdType).toLowerCase()
      : 'unknown',
    legalName: cleanText(row.legal_name ?? row.legalName),
    businessName: cleanText(row.business_name ?? row.businessName),
    mailingAddress: cleanText(row.mailing_address ?? row.mailingAddress),
    companyType: cleanText(row.company_type ?? row.companyType),
    source: cleanText(row.source),
    confidence: cleanText(row.extraction_confidence ?? row.confidence),
    updatedAt: cleanText(row.updated_at ?? row.updatedAt),
  };
}

export function maskedTaxId(lastFour) {
  const digits = cleanText(lastFour).replace(/\D/g, '').slice(-4);
  return digits.length === 4 ? `•••• ${digits}` : '';
}

function normalizeManualTaxId(value) {
  const text = cleanText(value);
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 9) throw new Error('Enter a valid 9-digit US tax ID.');
  return {
    value: text,
    taxIdType: /^\d{2}-\d{7}$/.test(text) ? 'ein' : /^\d{3}-\d{2}-\d{4}$/.test(text) ? 'ssn' : 'unknown',
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

export async function loadCertificateRenewalRequests() {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/certificate_renewal_requests?select=*&order=requested_at.desc,id.desc',
    { method: 'GET' },
    'Certificate renewal requests',
  );
  if (!response.ok) await readApiError(response, 'Unable to load certificate renewal history.');
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map(normalizeCertificateRenewalRequest);
}

export async function loadSubcontractorComplianceDocuments() {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/subcontractor_compliance_documents?select=*&order=subcontractor_id.asc,document_type.asc',
    { method: 'GET' },
    'Subcontractor compliance documents',
  );
  if (!response.ok) await readApiError(response, 'Unable to load subcontractor compliance documents.');
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map(normalizeSubcontractorComplianceDocument);
}

export function loadComplianceAssignmentSnapshot() {
  const session = getStoredAuthSession();
  const userScope = String(session?.user?.id || session?.user?.email || 'anonymous');
  return trackerQueryClient.query({
    key: ['compliance', 'assignment-warnings', userScope],
    staleTime: 60_000,
    queryFn: async () => {
      const [certificates, documents] = await Promise.all([
        loadInsuranceCertificates(),
        loadSubcontractorComplianceDocuments(),
      ]);
      return { certificates, documents };
    },
  });
}

export function invalidateComplianceAssignmentSnapshot() {
  trackerQueryClient.invalidateQueries(['compliance', 'assignment-warnings']);
}

export async function loadSubcontractorTaxIdStatuses() {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/get_subcontractor_tax_id_statuses',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    'Subcontractor tax ID status',
  );
  if (!response.ok) await readApiError(response, 'Unable to load subcontractor tax ID status.');
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map(normalizeSubcontractorTaxIdStatus);
}

export async function createCertificateRenewalRequest(subcontractorId, sourceCertificateId = '') {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/create_certificate_renewal_request',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_subcontractor_id: subcontractorId,
        p_source_certificate_id: sourceCertificateId || null,
      }),
    },
    'Certificate renewal request',
  );
  if (!response.ok) await readApiError(response, 'Unable to create the certificate renewal request.');
  const renewal = normalizeCertificateRenewalRequest(await response.json());
  const deliveryResponse = await fetchAuthorizedSupabase(
    '/functions/v1/send-project-notification',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'certificate-renewal-requested',
        eventId: renewal.id,
        entityId: renewal.id,
      }),
    },
    'Certificate renewal email',
  );
  if (!deliveryResponse.ok) await readApiError(deliveryResponse, 'The renewal was recorded, but its email could not be sent.');
  return { renewal, delivery: await deliveryResponse.json() };
}

export async function sendSubcontractorComplianceRequest(subcontractorId) {
  const eventId = globalThis.crypto?.randomUUID?.() || `compliance-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetchAuthorizedSupabase(
    '/functions/v1/send-project-notification',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'subcontractor-compliance-requested',
        eventId,
        entityId: subcontractorId,
      }),
    },
    'Subcontractor compliance email',
    45000,
  );
  if (!response.ok) await readApiError(response, 'Unable to send the subcontractor compliance email.');
  return response.json();
}

export async function updateCertificateRenewalStatus(renewal, status) {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/update_certificate_renewal_status',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_request_id: renewal.id,
        p_status: status,
        p_expected_version: renewal.version,
      }),
    },
    'Certificate renewal status',
  );
  if (!response.ok) await readApiError(response, 'Unable to update the certificate renewal status.');
  return normalizeCertificateRenewalRequest(await response.json());
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
  const saved = normalizeInsuranceCertificate(await response.json());
  invalidateComplianceAssignmentSnapshot();
  return saved;
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
  invalidateComplianceAssignmentSnapshot();
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

async function uploadCertificateStorageFile(file, category = '') {
  validateCertificateFile(file);
  const session = getStoredAuthSession();
  const userId = cleanText(session?.user?.id);
  const supabaseUrl = cleanText(getSupabaseDiagnosticsInfo().url);
  if (!userId || !supabaseUrl) throw new Error('Your signed-in session is required to upload a certificate.');

  const fileId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const categoryPath = cleanText(category).replace(/[^a-z0-9-]+/gi, '-');
  const storagePath = `certificates/${userId}/${categoryPath ? `${categoryPath}/` : ''}${fileId}-${safeFileName(file.name)}`;
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

export async function uploadCertificateFile(file) {
  return uploadCertificateStorageFile(file);
}

export async function saveSubcontractorComplianceDocument(document) {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/save_subcontractor_compliance_document',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_document: {
          id: document.id,
          subcontractorId: document.subcontractorId,
          documentType: document.documentType,
          signedDate: document.signedDate,
          sourceFileName: document.sourceFileName,
          sourceBucket: document.sourceBucket,
          sourcePath: document.sourcePath,
        },
        p_expected_version: document.version || null,
      }),
    },
    'Compliance document save',
  );
  if (!response.ok) await readApiError(response, 'Unable to save the compliance document.');
  const saved = normalizeSubcontractorComplianceDocument(await response.json());
  invalidateComplianceAssignmentSnapshot();
  return saved;
}

export async function uploadSubcontractorComplianceDocument(file, document) {
  const uploaded = await uploadCertificateStorageFile(file, 'compliance');
  try {
    return await saveUploadedSubcontractorComplianceDocument(uploaded, document);
  } catch (error) {
    await deleteCertificateFile(uploaded).catch(() => {});
    throw error;
  }
}

export async function saveUploadedSubcontractorComplianceDocument(uploaded, document) {
  const saved = await saveSubcontractorComplianceDocument({ ...document, ...uploaded });
  if (document.documentType !== 'w9') return saved;
  try {
    const taxIdStatus = document.manualTaxId
      ? await storeManualSubcontractorTaxId(document.subcontractorId, document.manualTaxId)
      : await extractAndStoreSubcontractorTaxId(document.subcontractorId, uploaded);
    return { ...saved, taxIdStatus };
  } catch (error) {
    return {
      ...saved,
      taxIdWarning: error instanceof Error ? error.message : 'Tax ID extraction failed. Enter it manually.',
    };
  }
}

async function manageSubcontractorTaxId(payload) {
  const response = await fetchAuthorizedSupabase(
    '/functions/v1/manage-subcontractor-tax-id',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    'Subcontractor tax ID',
    45000,
  );
  if (!response.ok) await readApiError(response, 'Unable to store the subcontractor tax ID.');
  return normalizeSubcontractorTaxIdStatus({ subcontractorId: payload.subcontractorId, ...await response.json() });
}

export async function extractAndStoreSubcontractorTaxId(subcontractorId, file) {
  return manageSubcontractorTaxId({
    action: 'extract',
    subcontractorId,
    sourcePath: file.sourcePath,
    contentType: file.contentType,
  });
}

export async function storeManualSubcontractorTaxId(subcontractorId, value) {
  const normalized = normalizeManualTaxId(value);
  return manageSubcontractorTaxId({
    action: 'manual',
    subcontractorId,
    taxId: normalized.value,
    taxIdType: normalized.taxIdType,
  });
}

export async function deleteSubcontractorComplianceDocument(document) {
  const response = await fetchAuthorizedSupabase(
    '/rest/v1/rpc/delete_subcontractor_compliance_document',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_document_id: document.id,
        p_expected_version: document.version,
      }),
    },
    'Compliance document delete',
  );
  if (!response.ok) await readApiError(response, 'Unable to delete the compliance document.');
  const deleted = normalizeSubcontractorComplianceDocument(await response.json());
  await deleteCertificateFile(deleted).catch(() => {});
  invalidateComplianceAssignmentSnapshot();
  return deleted;
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

export async function classifyComplianceDocument(file) {
  const response = await fetchAuthorizedSupabase(
    '/functions/v1/extract-insurance-certificate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'classify',
        sourcePath: file.sourcePath,
        contentType: file.contentType,
      }),
    },
    'Compliance document classification',
    45000,
  );
  if (!response.ok) await readApiError(response, 'Unable to identify the compliance document.');
  const payload = await response.json();
  const documentType = ['insurance_certificate', 'w9', 'subcontractor_agreement', 'unknown']
    .includes(cleanText(payload.documentType))
    ? cleanText(payload.documentType)
    : 'unknown';
  return {
    documentType,
    subcontractorName: cleanText(payload.subcontractorName),
    confidence: ['High', 'Medium', 'Low'].includes(payload.confidence) ? payload.confidence : 'Low',
  };
}
