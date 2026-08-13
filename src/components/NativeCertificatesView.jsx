import React, { useEffect, useMemo, useState } from 'react';
import { renderModalPortal, showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';
import { downloadFileWithUi } from '../utils/downloadUi.js';
import { formatFileSize } from '../utils/fileUi.js';
import { findClosestSubcontractor } from '../utils/certificateMatching.js';
import { is1099ReportingCompanyType, normalizeCompanyType } from '../utils/companyType.js';
import {
  certificateEligible,
  certificateMatchesStatusFilter,
  certificateStatus,
  sortCertificatesByExpiration,
  subcontractorComplianceStatus,
  subcontractorCertificateStatus,
  subcontractorLabel,
} from '../utils/certificateStatus.js';
import { reportError } from '../services/observability.js';
import { updatePerson } from '../services/trackerData.js';
import {
  classifyComplianceDocument,
  createCertificateRenewalRequest,
  deleteSubcontractorComplianceDocument,
  deleteCertificateFile,
  deleteInsuranceCertificate,
  extractInsuranceCertificate,
  loadCertificateRenewalRequests,
  loadInsuranceCertificates,
  loadSubcontractorComplianceDocuments,
  loadSubcontractorTaxIdStatuses,
  maskedTaxId,
  saveInsuranceCertificate,
  saveUploadedSubcontractorComplianceDocument,
  sendSubcontractorComplianceRequest,
  storeManualSubcontractorTaxId,
  updateCertificateRenewalStatus,
  uploadCertificateFile,
  uploadSubcontractorComplianceDocument,
  validateCertificateFile,
} from '../services/insuranceCertificates.js';

const EMPTY_COVERAGE = {
  id: '',
  type: 'General Liability',
  generalLimit: '',
  aggregateLimit: '',
  effectiveDate: '',
  expirationDate: '',
};
const MAX_BULK_CERTIFICATES = 20;
const COMPLIANCE_DOCUMENT_TYPE_LABELS = {
  insurance_certificate: 'Insurance certificate',
  w9: 'Form W-9',
  subcontractor_agreement: 'Subcontractor agreement',
  unknown: 'Needs review',
};
const RENEWAL_STATUS_LABELS = {
  requested: 'Requested',
  received: 'Received',
  under_review: 'Under review',
  accepted: 'Accepted',
};
const RENEWAL_NEXT_STATUS = {
  requested: 'received',
  received: 'under_review',
  under_review: 'accepted',
};

function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyCertificate(subcontractorId = '') {
  return {
    id: newId(),
    subcontractorId,
    holder: '',
    insured: '',
    insurer: '',
    policyNumber: '',
    effectiveDate: '',
    expirationDate: '',
    additionalInsured: false,
    sourceFileName: '',
    sourceBucket: '',
    sourcePath: '',
    extractionConfidence: '',
    extractionNotes: '',
    version: 0,
    coverages: [{ ...EMPTY_COVERAGE, id: newId() }],
  };
}

function copyCertificate(certificate) {
  return {
    ...certificate,
    coverages: (certificate.coverages?.length ? certificate.coverages : [EMPTY_COVERAGE]).map((coverage) => ({
      ...coverage,
      id: coverage.id || newId(),
      generalLimit: coverage.generalLimit || '',
      aggregateLimit: coverage.aggregateLimit || '',
    })),
  };
}

function formatCurrency(value) {
  const number = Number(value) || 0;
  return number ? number.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'Not entered';
}

function formatDisplayDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : 'Not entered';
}

function formatDisplayDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function normalizeCoverageLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function coverageTypeMatches(value, coverageTypes) {
  const normalized = normalizeCoverageLabel(value);
  return coverageTypes.some((type) =>
    normalized === type ||
    normalized.startsWith(`${type} `) ||
    normalized.endsWith(` ${type}`));
}

function coverageDateRange(certificate, coverageTypes, useCertificateFallback = false) {
  const coverage = (certificate?.coverages || []).find((item) =>
    coverageTypeMatches(item?.type, coverageTypes));
  const effectiveDate = coverage?.effectiveDate || (useCertificateFallback ? certificate?.effectiveDate : '');
  const expirationDate = coverage?.expirationDate || (useCertificateFallback ? certificate?.expirationDate : '');
  if (!effectiveDate && !expirationDate) return 'Not entered';
  return `${formatDisplayDate(effectiveDate)} – ${formatDisplayDate(expirationDate)}`;
}

function sourceFile(certificate) {
  return {
    originalName: certificate.sourceFileName,
    name: certificate.sourceFileName,
    storageBucket: certificate.sourceBucket,
    storagePath: certificate.sourcePath,
  };
}

function buildExtractedCertificate(base, uploaded, extracted, subcontractors) {
  const extractedName = extracted.subcontractorName || extracted.insured;
  const match = findClosestSubcontractor(extractedName, subcontractors);
  const { subcontractorName: _subcontractorName, ...certificateFields } = extracted;
  const matchNote = match
    ? `Matched subcontractor: ${subcontractorLabel(match.subcontractor)} from "${extractedName}".`
    : extractedName
      ? `No subcontractor match was selected for "${extractedName}".`
      : 'No subcontractor name was extracted.';
  return {
    ...base,
    ...certificateFields,
    subcontractorId: match?.subcontractor?.id || base.subcontractorId,
    sourceFileName: uploaded.sourceFileName,
    sourceBucket: uploaded.sourceBucket,
    sourcePath: uploaded.sourcePath,
    coverages: extracted.coverages.length ? extracted.coverages : base.coverages,
    extractionNotes: [certificateFields.extractionNotes, matchNote].filter(Boolean).join(' '),
  };
}

function CertificateModal({
  draft,
  subcontractors,
  file,
  busy,
  extracting,
  onChange,
  onCoverageChange,
  onAddCoverage,
  onRemoveCoverage,
  onFileChange,
  onExtract,
  onSelectAndExtract,
  onClose,
  onSave,
}) {
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card certificate-modal-card" role="dialog" aria-modal="true" aria-labelledby="certificate-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <p className="eyebrow">Subcontractor compliance</p>
            <h2 id="certificate-modal-title">{draft.version ? 'Edit insurance certificate' : 'Add insurance certificate'}</h2>
          </div>
        </div>

        <div className="project-form-grid certificate-form-grid">
          <label className="full">
            <span>Subcontractor *</span>
            <select value={draft.subcontractorId} onChange={(event) => onChange('subcontractorId', event.target.value)}>
              <option value="">Select subcontractor</option>
              {subcontractors.map((subcontractor) => {
                const eligible = certificateEligible(subcontractor);
                const suffix = subcontractor.inactive ? ' (Inactive)' : '';
                return (
                  <option
                    key={subcontractor.id}
                    value={subcontractor.id}
                    disabled={!eligible && subcontractor.id !== draft.subcontractorId}
                  >
                    {subcontractorLabel(subcontractor)}{suffix}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            <span>Insured name</span>
            <input value={draft.insured} onChange={(event) => onChange('insured', event.target.value)} />
          </label>
          <label>
            <span>Certificate holder</span>
            <input value={draft.holder} onChange={(event) => onChange('holder', event.target.value)} />
          </label>
          <label>
            <span>Insurance company</span>
            <input value={draft.insurer} onChange={(event) => onChange('insurer', event.target.value)} />
          </label>
          <label>
            <span>Policy number</span>
            <input value={draft.policyNumber} onChange={(event) => onChange('policyNumber', event.target.value)} />
          </label>
          <label>
            <span>Certificate effective date</span>
            <input type="date" value={draft.effectiveDate} onChange={(event) => onChange('effectiveDate', event.target.value)} />
          </label>
          <label>
            <span>Certificate expiration date</span>
            <input type="date" value={draft.expirationDate} onChange={(event) => onChange('expirationDate', event.target.value)} />
          </label>
          <label className="certificate-checkbox-field">
            <input type="checkbox" checked={draft.additionalInsured} onChange={(event) => onChange('additionalInsured', event.target.checked)} />
            <span>Certificate holder is additional insured</span>
          </label>
          <label>
            <span>Extraction confidence</span>
            <input value={draft.extractionConfidence || 'Not extracted'} readOnly />
          </label>
        </div>

        <section className="certificate-form-section">
          <div className="certificate-form-section-header">
            <div>
              <p className="eyebrow">Coverage</p>
              <h3>Coverage types and limits</h3>
            </div>
            <button className="button secondary" type="button" onClick={onAddCoverage} disabled={busy}>Add coverage</button>
          </div>
          <div className="certificate-coverage-editor">
            {draft.coverages.map((coverage, index) => (
              <div className="certificate-coverage-row" key={coverage.id || index}>
                <label>
                  <span>Coverage type</span>
                  <input value={coverage.type} onChange={(event) => onCoverageChange(index, 'type', event.target.value)} placeholder="General Liability" />
                </label>
                <label>
                  <span>General limit</span>
                  <input type="number" min="0" step="1000" value={coverage.generalLimit} onChange={(event) => onCoverageChange(index, 'generalLimit', event.target.value)} />
                </label>
                <label>
                  <span>Aggregate limit</span>
                  <input type="number" min="0" step="1000" value={coverage.aggregateLimit} onChange={(event) => onCoverageChange(index, 'aggregateLimit', event.target.value)} />
                </label>
                <label>
                  <span>Coverage effective date</span>
                  <input type="date" value={coverage.effectiveDate || ''} onChange={(event) => onCoverageChange(index, 'effectiveDate', event.target.value)} />
                </label>
                <label>
                  <span>Coverage expiration date</span>
                  <input type="date" value={coverage.expirationDate || ''} onChange={(event) => onCoverageChange(index, 'expirationDate', event.target.value)} />
                </label>
                <button className="button secondary danger certificate-remove-coverage" type="button" onClick={() => onRemoveCoverage(index)} disabled={draft.coverages.length === 1 || busy}>Remove</button>
              </div>
            ))}
          </div>
        </section>

        <section className="certificate-form-section">
          <div className="certificate-form-section-header">
            <div>
              <p className="eyebrow">Certificate file</p>
              <h3>PDF or image</h3>
            </div>
          </div>
          <label className="certificate-file-picker">
            <span>{file ? file.name : draft.sourceFileName || 'Choose a certificate file'}</span>
            <small>{file ? formatFileSize(file.size) : 'PDF, JPEG, PNG, or WebP · 15 MB maximum'}</small>
            <input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={(event) => onFileChange(event.target.files?.[0] || null)} disabled={busy} />
          </label>
          {draft.extractionNotes ? <p className="certificate-extraction-note">{draft.extractionNotes}</p> : null}
          <div className="certificate-extraction-actions">
            <label className={`button primary certificate-direct-extract${extracting ? ' is-loading' : ''}`}>
              {extracting ? 'Extracting...' : 'Select certificate & extract'}
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.files?.[0] || null;
                  event.target.value = '';
                  if (selected) onSelectAndExtract(selected);
                }}
              />
            </label>
            <button className={`button secondary${extracting ? ' is-loading' : ''}`} type="button" onClick={onExtract} disabled={!file || busy} aria-busy={extracting}>
              {extracting ? 'Extracting...' : 'Extract selected file'}
            </button>
          </div>
        </section>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`button primary${busy && !extracting ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={busy} aria-busy={busy && !extracting}>
            {busy && !extracting ? 'Saving...' : 'Save certificate'}
          </button>
        </div>
      </div>
    </div>,
  );
}

function bulkStatusLabel(item) {
  if (item.status === 'uploading') return 'Uploading';
  if (item.status === 'extracting') return 'Extracting';
  if (item.status === 'saving') return 'Saving';
  if (item.status === 'ready') return item.draft.subcontractorId ? 'Ready to save' : 'Needs subcontractor';
  if (item.status === 'error') return 'Needs attention';
  return 'Queued';
}

function BulkCertificateModal({
  items,
  subcontractors,
  processing,
  saving,
  onSubcontractorChange,
  onRetry,
  onRemove,
  onClose,
  onSave,
}) {
  const busy = processing || saving;
  const readyCount = items.filter((item) =>
    item.status === 'ready' &&
    item.draft.subcontractorId &&
    item.draft.coverages.some((coverage) => String(coverage.type || '').trim())).length;
  const completedCount = items.filter((item) => ['ready', 'error'].includes(item.status)).length;

  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card certificate-bulk-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="certificate-bulk-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">Subcontractor compliance</p>
            <h2 id="certificate-bulk-modal-title">Bulk upload and extract</h2>
            <p className="panel-copy">
              {busy
                ? `Processing ${completedCount} of ${items.length} certificates.`
                : `${readyCount} of ${items.length} certificates are ready to save.`}
            </p>
          </div>
        </div>

        <div className="certificate-bulk-list" aria-live="polite">
          {items.map((item) => (
            <article className={`certificate-bulk-item status-${item.status}`} key={item.id}>
              <div className="certificate-bulk-item-heading">
                <div>
                  <strong>{item.file.name}</strong>
                  <small>{formatFileSize(item.file.size)}</small>
                </div>
                <span>{bulkStatusLabel(item)}</span>
              </div>

              {item.status === 'ready' ? (
                <div className="certificate-bulk-result">
                  <label>
                    <span>Matched subcontractor *</span>
                    <select
                      value={item.draft.subcontractorId}
                      onChange={(event) => onSubcontractorChange(item.id, event.target.value)}
                      disabled={busy}
                    >
                      <option value="">Select subcontractor</option>
                      {subcontractors.map((subcontractor) => (
                        <option key={subcontractor.id} value={subcontractor.id}>
                          {subcontractorLabel(subcontractor)}
                          {subcontractor.inactive ? ' (Inactive)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <span>Extracted details</span>
                    <strong>{item.draft.insurer || item.draft.insured || 'Review after saving'}</strong>
                    <small>
                      {[item.draft.policyNumber, item.draft.expirationDate ? `Expires ${formatDisplayDate(item.draft.expirationDate)}` : '']
                        .filter(Boolean)
                        .join(' · ') || `${item.draft.coverages.length} coverage row(s)`}
                    </small>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{item.draft.extractionConfidence || 'Low'}</strong>
                  </div>
                </div>
              ) : null}

              {item.error ? <p className="certificate-bulk-error">{item.error}</p> : null}

              <div className="certificate-bulk-item-actions">
                {item.status === 'error' ? (
                  <button className="button secondary" type="button" onClick={() => onRetry(item)} disabled={busy}>
                    Retry
                  </button>
                ) : null}
                <button className="button secondary danger" type="button" onClick={() => onRemove(item)} disabled={busy}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>

        <p className="certificate-bulk-help">
          Extraction runs one certificate at a time. Confirm each subcontractor match before saving.
        </p>

        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={`button primary${saving ? ' is-loading' : ''}`} type="button" onClick={onSave} disabled={busy || !readyCount}>
            {saving ? 'Saving...' : `Save ${readyCount} certificate${readyCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
  );
}

function ComplianceUploadRoutingModal({
  upload,
  subcontractors,
  busy,
  onChange,
  onClose,
  onContinue,
}) {
  const detectedLabel = COMPLIANCE_DOCUMENT_TYPE_LABELS[upload.classification.documentType] || 'Needs review';
  const continueLabel = upload.documentType === 'insurance_certificate'
    ? 'Extract certificate'
    : upload.documentType === 'w9'
      ? 'Save and extract W-9'
      : 'Save agreement';
  return renderModalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card compliance-upload-routing-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compliance-upload-routing-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <div>
            <p className="eyebrow">Document identified</p>
            <h2 id="compliance-upload-routing-title">Review compliance upload</h2>
            <p className="panel-copy">Confirm the document type and subcontractor before detailed extraction.</p>
          </div>
        </div>
        <div className="compliance-upload-detection">
          <div><span>File</span><strong>{upload.file.name}</strong></div>
          <div><span>Detected type</span><strong>{detectedLabel}</strong></div>
          <div><span>Confidence</span><strong>{upload.classification.confidence}</strong></div>
          <div><span>Detected company</span><strong>{upload.classification.subcontractorName || 'Not identified'}</strong></div>
        </div>
        <div className="project-form-grid">
          <label>
            <span>Document type *</span>
            <select value={upload.documentType} onChange={(event) => onChange('documentType', event.target.value)} disabled={busy}>
              <option value="unknown">Select document type</option>
              <option value="insurance_certificate">Insurance certificate</option>
              <option value="w9">Form W-9</option>
              <option value="subcontractor_agreement">Subcontractor agreement</option>
            </select>
          </label>
          <label>
            <span>Subcontractor *</span>
            <select value={upload.subcontractorId} onChange={(event) => onChange('subcontractorId', event.target.value)} disabled={busy}>
              <option value="">Select subcontractor</option>
              {subcontractors.map((subcontractor) => (
                <option key={subcontractor.id} value={subcontractor.id}>
                  {subcontractorLabel(subcontractor)}{subcontractor.inactive ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {upload.error ? <p className="certificate-bulk-error">{upload.error}</p> : null}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={`button primary${busy ? ' is-loading' : ''}`}
            type="button"
            onClick={onContinue}
            disabled={busy || upload.documentType === 'unknown' || !upload.subcontractorId}
          >
            {busy ? 'Processing...' : continueLabel}
          </button>
        </div>
      </div>
    </div>,
  );
}

export default function NativeCertificatesView({ data, activeUser, onStateChange, navigationTarget = null }) {
  const canEdit = ['Admin', 'Edit'].includes(activeUser?.role);
  const subcontractors = useMemo(
    () => [...(data.subs || [])].sort((a, b) => subcontractorLabel(a).localeCompare(subcontractorLabel(b))),
    [data.subs],
  );
  const subcontractorById = useMemo(
    () => new Map(subcontractors.map((subcontractor) => [subcontractor.id, subcontractor])),
    [subcontractors],
  );
  const eligibleSubcontractors = useMemo(
    () => subcontractors.filter(certificateEligible),
    [subcontractors],
  );
  const [certificates, setCertificates] = useState([]);
  const [renewalRequests, setRenewalRequests] = useState([]);
  const [complianceDocuments, setComplianceDocuments] = useState([]);
  const [taxIdStatuses, setTaxIdStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState('active');
  const [statusFilter, setStatusFilter] = useState('all');
  const [subcontractorFilter, setSubcontractorFilter] = useState('all');
  const [draft, setDraft] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [originalCertificate, setOriginalCertificate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [expandedCoverageIds, setExpandedCoverageIds] = useState(() => new Set());
  const [expandedSubcontractorIds, setExpandedSubcontractorIds] = useState(() => new Set());
  const [subcontractorSavingId, setSubcontractorSavingId] = useState('');
  const [renewalSavingId, setRenewalSavingId] = useState('');
  const [complianceEmailSendingId, setComplianceEmailSendingId] = useState('');
  const [complianceEmailSavingId, setComplianceEmailSavingId] = useState('');
  const [complianceEmailDrafts, setComplianceEmailDrafts] = useState({});
  const [complianceSavingKey, setComplianceSavingKey] = useState('');
  const [complianceTaxIdDrafts, setComplianceTaxIdDrafts] = useState({});
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [complianceDropActive, setComplianceDropActive] = useState(false);
  const [complianceUpload, setComplianceUpload] = useState(null);
  const [complianceUploadBusy, setComplianceUploadBusy] = useState(false);

  async function refreshCertificates() {
    setLoading(true);
    setLoadError('');
    try {
      const [certificateRows, renewalRows, complianceRows, taxIdRows] = await Promise.all([
        loadInsuranceCertificates(),
        loadCertificateRenewalRequests(),
        loadSubcontractorComplianceDocuments(),
        loadSubcontractorTaxIdStatuses(),
      ]);
      setCertificates(certificateRows);
      setRenewalRequests(renewalRows);
      setComplianceDocuments(complianceRows);
      setTaxIdStatuses(taxIdRows);
    } catch (error) {
      reportError(error, { operation: 'certificate.list', workspace: 'certificates' });
      setLoadError(error instanceof Error ? error.message : 'Unable to load insurance certificates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshCertificates();
  }, []);

  useEffect(() => {
    if (!navigationTarget?.subcontractorId && !navigationTarget?.statusId) return;
    setSubcontractorFilter(navigationTarget.subcontractorId || 'all');
    if (navigationTarget.statusId === 'inactive') {
      setActivityFilter('inactive');
      setStatusFilter('all');
    } else {
      setActivityFilter('active');
      setStatusFilter(navigationTarget.statusId || 'all');
    }
    setSearch('');
  }, [navigationTarget]);

  function startCreate(subcontractorId = '') {
    const filteredSubcontractor = subcontractorFilter !== 'all' ? subcontractorFilter : '';
    const preferredSubcontractor = subcontractorId || filteredSubcontractor;
    const initialSubcontractor = certificateEligible(subcontractorById.get(preferredSubcontractor))
      ? preferredSubcontractor
      : '';
    const next = emptyCertificate(initialSubcontractor);
    if (initialSubcontractor) next.insured = subcontractorLabel(subcontractorById.get(initialSubcontractor));
    setOriginalCertificate(null);
    setPendingUpload(null);
    setSelectedFile(null);
    setDraft(next);
  }

  function startEdit(certificate) {
    setOriginalCertificate(certificate);
    setPendingUpload(null);
    setSelectedFile(null);
    setDraft(copyCertificate(certificate));
  }

  async function closeModal() {
    if (saving) return;
    if (pendingUpload?.sourcePath && pendingUpload.sourcePath !== originalCertificate?.sourcePath) {
      await deleteCertificateFile(pendingUpload).catch(() => {});
    }
    setDraft(null);
    setSelectedFile(null);
    setPendingUpload(null);
    setOriginalCertificate(null);
  }

  function updateDraft(key, value) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'subcontractorId' && !current.insured) {
        next.insured = subcontractorLabel(subcontractorById.get(value));
      }
      return next;
    });
  }

  function updateCoverage(index, key, value) {
    setDraft((current) => ({
      ...current,
      coverages: current.coverages.map((coverage, coverageIndex) =>
        coverageIndex === index ? { ...coverage, [key]: value } : coverage),
    }));
  }

  async function selectFile(file) {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    try {
      validateCertificateFile(file);
      if (pendingUpload?.sourcePath && pendingUpload.sourcePath !== originalCertificate?.sourcePath) {
        await deleteCertificateFile(pendingUpload).catch(() => {});
      }
      setPendingUpload(null);
      setSelectedFile(file);
    } catch (error) {
      await showAppAlert(error instanceof Error ? error.message : 'Choose a supported certificate file.', 'File unavailable');
    }
  }

  async function ensurePendingUpload() {
    if (pendingUpload) return pendingUpload;
    if (!selectedFile) return null;
    const uploaded = await uploadCertificateFile(selectedFile);
    setPendingUpload(uploaded);
    return uploaded;
  }

  async function handleExtract(fileToExtract = null) {
    setSaving(true);
    setExtracting(true);
    try {
      let uploaded;
      if (fileToExtract) {
        validateCertificateFile(fileToExtract);
        if (pendingUpload?.sourcePath && pendingUpload.sourcePath !== originalCertificate?.sourcePath) {
          await deleteCertificateFile(pendingUpload).catch(() => {});
        }
        setSelectedFile(fileToExtract);
        uploaded = await uploadCertificateFile(fileToExtract);
        setPendingUpload(uploaded);
      } else {
        uploaded = await ensurePendingUpload();
      }
      if (!uploaded) throw new Error('Choose a certificate file to extract.');
      const extracted = await extractInsuranceCertificate(uploaded);
      setDraft((current) => buildExtractedCertificate(current, uploaded, extracted, subcontractors));
    } catch (error) {
      reportError(error, { operation: 'certificate.extract', workspace: 'certificates' });
      await showAppAlert(error instanceof Error ? error.message : 'Unable to extract the certificate.', 'Extraction failed');
    } finally {
      setExtracting(false);
      setSaving(false);
    }
  }

  function updateBulkItem(itemId, updates) {
    setBulkItems((current) => current.map((item) =>
      item.id === itemId
        ? { ...item, ...(typeof updates === 'function' ? updates(item) : updates) }
        : item));
  }

  async function extractBulkItem(item) {
    let uploaded = item.uploaded || null;
    try {
      if (!uploaded) {
        updateBulkItem(item.id, { status: 'uploading', error: '' });
        uploaded = await uploadCertificateFile(item.file);
        updateBulkItem(item.id, { uploaded });
      }
      updateBulkItem(item.id, { status: 'extracting', error: '' });
      const extracted = await extractInsuranceCertificate(uploaded);
      const nextDraft = buildExtractedCertificate(
        item.draft || emptyCertificate(),
        uploaded,
        extracted,
        subcontractors,
      );
      updateBulkItem(item.id, {
        uploaded,
        draft: nextDraft,
        status: 'ready',
        error: '',
      });
    } catch (error) {
      reportError(error, { operation: 'certificate.bulk-extract', workspace: 'certificates' });
      updateBulkItem(item.id, {
        uploaded,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unable to upload or extract this certificate.',
      });
    }
  }

  async function processBulkItems(items) {
    setBulkProcessing(true);
    try {
      for (const item of items) {
        if (item.status !== 'error') await extractBulkItem(item);
      }
    } finally {
      setBulkProcessing(false);
    }
  }

  async function startBulkUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > MAX_BULK_CERTIFICATES) {
      await showAppAlert(
        `Select no more than ${MAX_BULK_CERTIFICATES} certificate files at a time.`,
        'Too many files',
      );
      return;
    }

    const items = files.map((file) => {
      let error = '';
      try {
        validateCertificateFile(file);
      } catch (validationError) {
        error = validationError instanceof Error ? validationError.message : 'Unsupported certificate file.';
      }
      return {
        id: newId(),
        file,
        uploaded: null,
        draft: emptyCertificate(),
        status: error ? 'error' : 'queued',
        error,
      };
    });
    setBulkItems(items);
    setBulkOpen(true);
    await processBulkItems(items);
  }

  async function startComplianceUpload(file) {
    if (!file || complianceUploadBusy) return;
    let uploaded = null;
    setComplianceDropActive(false);
    setComplianceUploadBusy(true);
    try {
      validateCertificateFile(file);
      uploaded = await uploadCertificateFile(file);
      const classification = await classifyComplianceDocument(uploaded);
      const match = findClosestSubcontractor(classification.subcontractorName, subcontractors);
      setComplianceUpload({
        file,
        uploaded,
        classification,
        documentType: classification.documentType,
        subcontractorId: match?.subcontractor?.id || '',
        error: '',
      });
    } catch (error) {
      if (uploaded?.sourcePath) await deleteCertificateFile(uploaded).catch(() => {});
      reportError(error, { operation: 'compliance.document-classify', workspace: 'compliance' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to identify the compliance document.',
        'Document classification failed',
      );
    } finally {
      setComplianceUploadBusy(false);
    }
  }

  async function handleComplianceFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 1) {
      await showAppAlert(
        'Drop one compliance document at a time so its type and subcontractor can be confirmed.',
        'One document at a time',
      );
      return;
    }
    await startComplianceUpload(files[0]);
  }

  async function closeComplianceUpload() {
    if (complianceUploadBusy) return;
    if (complianceUpload?.uploaded?.sourcePath) {
      await deleteCertificateFile(complianceUpload.uploaded).catch(() => {});
    }
    setComplianceUpload(null);
  }

  async function continueComplianceUpload() {
    if (!complianceUpload || complianceUploadBusy) return;
    const subcontractor = subcontractorById.get(complianceUpload.subcontractorId);
    if (!subcontractor || complianceUpload.documentType === 'unknown') return;
    setComplianceUploadBusy(true);
    setComplianceUpload((current) => current ? { ...current, error: '' } : current);
    try {
      if (complianceUpload.documentType === 'insurance_certificate') {
        const extracted = await extractInsuranceCertificate(complianceUpload.uploaded);
        const base = emptyCertificate(subcontractor.id);
        base.insured = subcontractorLabel(subcontractor);
        const nextDraft = buildExtractedCertificate(
          base,
          complianceUpload.uploaded,
          extracted,
          subcontractors,
        );
        setOriginalCertificate(null);
        setPendingUpload(complianceUpload.uploaded);
        setSelectedFile(complianceUpload.file);
        setDraft({ ...nextDraft, subcontractorId: subcontractor.id });
        setComplianceUpload(null);
      } else {
        const saved = await saveComplianceDocument(
          subcontractor,
          complianceUpload.documentType,
          null,
          complianceUpload.uploaded,
        );
        if (saved) setComplianceUpload(null);
      }
    } catch (error) {
      reportError(error, { operation: 'compliance.document-route', workspace: 'compliance' });
      setComplianceUpload((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : 'Unable to process this compliance document.',
      } : current);
    } finally {
      setComplianceUploadBusy(false);
    }
  }

  async function retryBulkItem(item) {
    setBulkProcessing(true);
    try {
      await extractBulkItem(item);
    } finally {
      setBulkProcessing(false);
    }
  }

  async function removeBulkItem(item) {
    if (item.uploaded?.sourcePath) {
      await deleteCertificateFile(item.uploaded).catch(() => {});
    }
    setBulkItems((current) => current.filter((candidate) => candidate.id !== item.id));
    if (bulkItems.length === 1) setBulkOpen(false);
  }

  async function closeBulkModal() {
    if (bulkProcessing || bulkSaving) return;
    const uploads = bulkItems
      .map((item) => item.uploaded)
      .filter((uploaded) => uploaded?.sourcePath);
    await Promise.all(uploads.map((uploaded) => deleteCertificateFile(uploaded).catch(() => {})));
    setBulkItems([]);
    setBulkOpen(false);
  }

  async function handleBulkSave() {
    const readyItems = bulkItems.filter((item) =>
      item.status === 'ready' &&
      item.draft.subcontractorId &&
      item.draft.coverages.some((coverage) => String(coverage.type || '').trim()));
    if (!readyItems.length) {
      await showAppAlert('Confirm at least one subcontractor match before saving.', 'No certificates ready');
      return;
    }

    setBulkSaving(true);
    let savedCount = 0;
    try {
      for (const item of readyItems) {
        updateBulkItem(item.id, { status: 'saving', error: '' });
        try {
          const saved = await saveInsuranceCertificate(item.draft);
          savedCount += 1;
          setCertificates((current) => [saved, ...current.filter((certificate) => certificate.id !== saved.id)]);
          setBulkItems((current) => current.filter((candidate) => candidate.id !== item.id));
        } catch (error) {
          reportError(error, { operation: 'certificate.bulk-save', workspace: 'certificates' });
          updateBulkItem(item.id, {
            status: 'ready',
            error: error instanceof Error ? error.message : 'Unable to save this certificate.',
          });
        }
      }
    } finally {
      setBulkSaving(false);
    }

    if (savedCount) {
      setRenewalRequests(await loadCertificateRenewalRequests().catch(() => renewalRequests));
    }

    if (savedCount === bulkItems.length) {
      setBulkItems([]);
      setBulkOpen(false);
    }
  }

  async function handleSave() {
    if (!draft?.subcontractorId) {
      await showAppAlert('Select a subcontractor.', 'Subcontractor required');
      return;
    }
    if (!draft.coverages.some((coverage) => String(coverage.type || '').trim())) {
      await showAppAlert('Add at least one coverage type.', 'Coverage required');
      return;
    }
    setSaving(true);
    try {
      const uploaded = await ensurePendingUpload();
      const nextDraft = uploaded
        ? {
          ...draft,
          sourceFileName: uploaded.sourceFileName,
          sourceBucket: uploaded.sourceBucket,
          sourcePath: uploaded.sourcePath,
        }
        : draft;
      const saved = await saveInsuranceCertificate(nextDraft);
      if (
        originalCertificate?.sourcePath &&
        saved.sourcePath !== originalCertificate.sourcePath
      ) {
        await deleteCertificateFile(originalCertificate).catch(() => {});
      }
      setCertificates((current) => [saved, ...current.filter((certificate) => certificate.id !== saved.id)]);
      setRenewalRequests(await loadCertificateRenewalRequests().catch(() => renewalRequests));
      setDraft(null);
      setSelectedFile(null);
      setPendingUpload(null);
      setOriginalCertificate(null);
    } catch (error) {
      reportError(error, { operation: 'certificate.save', workspace: 'certificates' });
      await showAppAlert(error instanceof Error ? error.message : 'Unable to save the certificate.', 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(certificate) {
    const confirmed = await showAppConfirm(
      `Delete the certificate for ${subcontractorLabel(subcontractorById.get(certificate.subcontractorId))}? Its stored document will also be removed.`,
      { title: 'Delete insurance certificate', confirmLabel: 'Delete', tone: 'danger' },
    );
    if (!confirmed) return;
    try {
      await deleteInsuranceCertificate(certificate);
      setCertificates((current) => current.filter((item) => item.id !== certificate.id));
    } catch (error) {
      reportError(error, { operation: 'certificate.delete', workspace: 'certificates' });
      await showAppAlert(error instanceof Error ? error.message : 'Unable to delete the certificate.', 'Delete failed');
    }
  }

  async function updateSubcontractorCompliance(subcontractor, updates) {
    setSubcontractorSavingId(subcontractor.id);
    try {
      const nextState = await updatePerson(data, 'sub', subcontractor.id, updates);
      onStateChange(nextState);
    } catch (error) {
      reportError(error, { operation: 'certificate.subcontractor-status', workspace: 'certificates' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to update the subcontractor.',
        'Update failed',
      );
    } finally {
      setSubcontractorSavingId('');
    }
  }

  async function requestCertificateRenewal(subcontractor, latestCertificate) {
    if (data.settings?.complianceEmailTestMode === true) {
      const confirmed = await showAppConfirm(
        `Compliance email test mode is on. Send this renewal email to ${activeUser?.email} instead of ${subcontractor.email}?`,
        { title: 'Send test renewal email', confirmLabel: 'Send test email' },
      );
      if (!confirmed) return;
    }
    setRenewalSavingId(subcontractor.id);
    try {
      const result = await createCertificateRenewalRequest(subcontractor.id, latestCertificate?.id || '');
      await refreshCertificates();
      if (result.delivery?.emailStatus === 'sent') {
        await showAppAlert(
          result.delivery?.testMode
            ? `Test renewal email sent to ${activeUser?.email}. Intended subcontractor: ${subcontractor.email}.`
            : `Renewal request sent to ${subcontractor.email}.`,
          result.delivery?.testMode ? 'Test email sent' : 'Renewal requested',
        );
      } else {
        await showAppAlert(
          'The renewal request was recorded, but email delivery is unavailable. The request remains visible for follow-up.',
          'Email not sent',
        );
      }
    } catch (error) {
      reportError(error, { operation: 'certificate.renewal-request', workspace: 'certificates' });
      await refreshCertificates().catch(() => {});
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to request the certificate renewal.',
        'Renewal request failed',
      );
    } finally {
      setRenewalSavingId('');
    }
  }

  async function saveSubcontractorEmail(subcontractor) {
    const email = String(complianceEmailDrafts[subcontractor.id] || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await showAppAlert('Enter a valid email address.', 'Valid email required');
      return;
    }
    setComplianceEmailSavingId(subcontractor.id);
    try {
      const nextState = await updatePerson(data, 'sub', subcontractor.id, { email });
      onStateChange(nextState);
      setComplianceEmailDrafts((current) => {
        const next = { ...current };
        delete next[subcontractor.id];
        return next;
      });
    } catch (error) {
      reportError(error, { operation: 'compliance.subcontractor-email-save', workspace: 'compliance' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to save the subcontractor email address.',
        'Email save failed',
      );
    } finally {
      setComplianceEmailSavingId('');
    }
  }

  async function requestSubcontractorCompliance(subcontractor, complianceStatus) {
    const email = String(subcontractor.email || '').trim();
    if (!email) {
      await showAppAlert('Add a valid subcontractor email in People before sending a compliance request.', 'Email required');
      return;
    }
    const missingLabels = complianceStatus.missing.map((requirement) => requirement.label).join(', ');
    const testModeNotice = data.settings?.complianceEmailTestMode === true
      ? ` Test mode is on, so the email will go to ${activeUser?.email} instead of the subcontractor.`
      : '';
    const confirmed = await showAppConfirm(
      `Send a compliance request for ${email} for: ${missingLabels}? Applicable blank forms and the redacted sample certificate will be attached.${testModeNotice}`,
      {
        title: data.settings?.complianceEmailTestMode === true ? 'Send test compliance email' : 'Email compliance request',
        confirmLabel: data.settings?.complianceEmailTestMode === true ? 'Send test email' : 'Send email',
      },
    );
    if (!confirmed) return;
    setComplianceEmailSendingId(subcontractor.id);
    try {
      const result = await sendSubcontractorComplianceRequest(subcontractor.id);
      if (result.emailStatus === 'sent') {
        let requestMarkerSaveError = false;
        if (!result.testMode) {
          try {
            const nextState = await updatePerson(data, 'sub', subcontractor.id, {
              complianceRequestedRequirements: complianceStatus.missing.map((requirement) => requirement.id),
              complianceRequestedAt: new Date().toISOString(),
            });
            onStateChange(nextState);
          } catch (markerError) {
            requestMarkerSaveError = true;
            reportError(markerError, { operation: 'compliance.request-marker-save', workspace: 'compliance' });
          }
        }
        const attachmentSummary = result.attachmentNames?.length
          ? ` Attachments: ${result.attachmentNames.join(', ')}.`
          : '';
        const markerSummary = requestMarkerSaveError
          ? ' The email was sent, but the Requested icons could not be saved; refresh and review before sending again.'
          : '';
        await showAppAlert(
          result.testMode
            ? `Test compliance email sent to ${activeUser?.email}. Intended subcontractor: ${email}.${attachmentSummary}`
            : `Compliance request sent to ${email}.${attachmentSummary}${markerSummary}`,
          result.testMode ? 'Test email sent' : 'Compliance request sent',
        );
      } else {
        await showAppAlert('The compliance request could not be delivered. Check email delivery configuration and try again.', 'Email not sent');
      }
    } catch (error) {
      reportError(error, { operation: 'compliance.email-request', workspace: 'compliance' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to send the subcontractor compliance request.',
        'Compliance email failed',
      );
    } finally {
      setComplianceEmailSendingId('');
    }
  }

  async function advanceCertificateRenewal(renewal) {
    const nextStatus = RENEWAL_NEXT_STATUS[renewal.status];
    if (!nextStatus) return;
    setRenewalSavingId(renewal.subcontractorId);
    try {
      const saved = await updateCertificateRenewalStatus(renewal, nextStatus);
      setRenewalRequests((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (error) {
      reportError(error, { operation: 'certificate.renewal-status', workspace: 'certificates' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to update the renewal status.',
        'Renewal update failed',
      );
    } finally {
      setRenewalSavingId('');
    }
  }

  async function saveComplianceDocument(subcontractor, documentType, file, uploadedFile = null) {
    if (!file && !uploadedFile) return false;
    const key = `${subcontractor.id}:${documentType}`;
    const existing = complianceDocuments.find((document) =>
      document.subcontractorId === subcontractor.id && document.documentType === documentType) || null;
    const manualTaxId = documentType === 'w9' ? complianceTaxIdDrafts[key] || '' : '';
    setComplianceSavingKey(key);
    try {
      const documentPayload = {
        id: existing?.id || newId(),
        subcontractorId: subcontractor.id,
        documentType,
        signedDate: existing?.signedDate || '',
        manualTaxId,
        version: existing?.version || 0,
      };
      const saved = uploadedFile
        ? await saveUploadedSubcontractorComplianceDocument(uploadedFile, documentPayload)
        : await uploadSubcontractorComplianceDocument(file, documentPayload);
      const { taxIdStatus, taxIdWarning, ...savedDocument } = saved;
      if (existing?.sourcePath && existing.sourcePath !== saved.sourcePath) {
        await deleteCertificateFile(existing).catch(() => {});
      }
      setComplianceDocuments((current) => [
        savedDocument,
        ...current.filter((document) => document.id !== savedDocument.id),
      ]);
      setComplianceTaxIdDrafts((current) => ({ ...current, [key]: '' }));
      if (taxIdStatus) {
        setTaxIdStatuses((current) => [
          taxIdStatus,
          ...current.filter((status) => status.subcontractorId !== taxIdStatus.subcontractorId),
        ]);
        const extractedCompanyType = normalizeCompanyType(taxIdStatus.companyType);
        const peopleUpdates = {};
        if (taxIdStatus.legalName && taxIdStatus.legalName !== subcontractor.legalName) {
          peopleUpdates.legalName = taxIdStatus.legalName;
        }
        const extracted1099Exempt = extractedCompanyType ? !is1099ReportingCompanyType(extractedCompanyType) : false;
        if (extractedCompanyType && (
          extractedCompanyType !== subcontractor.companyType
          || extracted1099Exempt !== (subcontractor.is1099Exempt === true)
        )) {
          peopleUpdates.companyType = extractedCompanyType;
          peopleUpdates.is1099Exempt = extracted1099Exempt;
        }
        if (Object.keys(peopleUpdates).length) {
          try {
            const nextState = await updatePerson(data, 'sub', subcontractor.id, peopleUpdates);
            onStateChange(nextState);
          } catch (error) {
            reportError(error, { operation: 'compliance.w9-people-save', workspace: 'compliance' });
            await showAppAlert(
              'The W-9 and tax ID were saved, but the extracted Legal Name or Company Type could not be saved to People. Refresh and enter it manually.',
              'People update failed',
            );
          }
        }
      }
      if (taxIdWarning) await showAppAlert(taxIdWarning, 'Tax ID needs review');
      return true;
    } catch (error) {
      reportError(error, { operation: 'compliance.document-save', workspace: 'compliance' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to save the compliance document.',
        'Document save failed',
      );
      return false;
    } finally {
      setComplianceSavingKey('');
    }
  }

  async function saveManualTaxId(subcontractor) {
    const key = `${subcontractor.id}:w9`;
    const value = complianceTaxIdDrafts[key] || '';
    if (!value.trim()) {
      await showAppAlert('Enter the 9-digit tax ID.', 'Tax ID required');
      return;
    }
    setComplianceSavingKey(key);
    try {
      const savedStatus = await storeManualSubcontractorTaxId(subcontractor.id, value);
      setTaxIdStatuses((current) => [
        savedStatus,
        ...current.filter((status) => status.subcontractorId !== subcontractor.id),
      ]);
      setComplianceTaxIdDrafts((current) => ({ ...current, [key]: '' }));
    } catch (error) {
      reportError(error, { operation: 'compliance.tax-id-save', workspace: 'compliance' });
      await showAppAlert(error instanceof Error ? error.message : 'Unable to store the tax ID.', 'Tax ID save failed');
    } finally {
      setComplianceSavingKey('');
    }
  }

  async function removeComplianceDocument(document) {
    const confirmed = await showAppConfirm(
      `Remove ${document.documentType === 'w9' ? 'Form W-9' : 'the subcontractor agreement'} from compliance records?`,
      { title: 'Remove compliance document', confirmLabel: 'Remove', tone: 'danger' },
    );
    if (!confirmed) return;
    const key = `${document.subcontractorId}:${document.documentType}`;
    setComplianceSavingKey(key);
    try {
      await deleteSubcontractorComplianceDocument(document);
      setComplianceDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (error) {
      reportError(error, { operation: 'compliance.document-delete', workspace: 'compliance' });
      await showAppAlert(
        error instanceof Error ? error.message : 'Unable to remove the compliance document.',
        'Document removal failed',
      );
    } finally {
      setComplianceSavingKey('');
    }
  }

  const renewalRequestsBySubcontractor = useMemo(() => {
    const result = new Map();
    renewalRequests.forEach((renewal) => {
      if (!result.has(renewal.subcontractorId)) result.set(renewal.subcontractorId, []);
      result.get(renewal.subcontractorId).push(renewal);
    });
    return result;
  }, [renewalRequests]);

  const taxIdStatusBySubcontractor = useMemo(
    () => new Map(taxIdStatuses.map((status) => [status.subcontractorId, status])),
    [taxIdStatuses],
  );

  const subcontractorRoster = useMemo(() => {
    const certificatesBySubcontractor = new Map();
    certificates.forEach((certificate) => {
      if (!certificatesBySubcontractor.has(certificate.subcontractorId)) {
        certificatesBySubcontractor.set(certificate.subcontractorId, []);
      }
      certificatesBySubcontractor.get(certificate.subcontractorId).push(certificate);
    });
    const documentsBySubcontractor = new Map();
    complianceDocuments.forEach((document) => {
      if (!documentsBySubcontractor.has(document.subcontractorId)) documentsBySubcontractor.set(document.subcontractorId, []);
      documentsBySubcontractor.get(document.subcontractorId).push(document);
    });
    return subcontractors.map((subcontractor) => {
      const subcontractorCertificates = sortCertificatesByExpiration(
        certificatesBySubcontractor.get(subcontractor.id) || [],
      );
      const subcontractorDocuments = documentsBySubcontractor.get(subcontractor.id) || [];
      return {
        subcontractor,
        certificates: subcontractorCertificates,
        documents: subcontractorDocuments,
        insuranceStatus: subcontractorCertificateStatus(subcontractor, subcontractorCertificates),
        complianceStatus: subcontractorComplianceStatus(subcontractor, subcontractorCertificates, subcontractorDocuments),
      };
    });
  }, [certificates, complianceDocuments, subcontractors]);

  const filteredRoster = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return subcontractorRoster.filter(({ subcontractor, certificates: subcontractorCertificates, complianceStatus, insuranceStatus }) => {
      if (activityFilter === 'active' && subcontractor.inactive === true) return false;
      if (activityFilter === 'inactive' && subcontractor.inactive !== true) return false;
      if (['liability-compliant', 'liability-non-compliant'].includes(statusFilter)) {
        const generalLiability = complianceStatus.requirements.find((requirement) => requirement.id === 'general_liability');
        if (!generalLiability || generalLiability.satisfied !== (statusFilter === 'liability-compliant')) return false;
      } else if (['compliant', 'needs-attention'].includes(statusFilter)) {
        if (complianceStatus.id !== statusFilter) return false;
      } else if (!certificateMatchesStatusFilter(insuranceStatus.id, statusFilter)) return false;
      if (subcontractorFilter !== 'all' && subcontractor.id !== subcontractorFilter) return false;
      if (!needle) return true;
      return [
        subcontractorLabel(subcontractor),
        subcontractor.first,
        subcontractor.last,
        subcontractor.email,
        subcontractor.phone,
        ...subcontractorCertificates.flatMap((certificate) => [
          certificate.insured,
          certificate.insurer,
          certificate.policyNumber,
          ...certificate.coverages.map((coverage) => coverage.type),
        ]),
      ].some((value) => String(value || '').toLowerCase().includes(needle));
    });
  }, [activityFilter, search, statusFilter, subcontractorFilter, subcontractorRoster]);

  const stats = useMemo(() => {
    const activityRoster = subcontractorRoster.filter(({ subcontractor }) => {
      if (activityFilter === 'active') return subcontractor.inactive !== true;
      if (activityFilter === 'inactive') return subcontractor.inactive === true;
      return true;
    });
    const result = {
      total: activityRoster.length,
      active: 0,
      expiring: 0,
      expired: 0,
      missing: 0,
      'not-required': 0,
      inactive: 0,
      compliant: 0,
      'needs-attention': 0,
      'liability-compliant': 0,
      'liability-non-compliant': 0,
    };
    activityRoster.forEach(({ insuranceStatus, complianceStatus }) => {
      result[insuranceStatus.id] = (result[insuranceStatus.id] || 0) + 1;
      if (complianceStatus.id !== insuranceStatus.id) {
        result[complianceStatus.id] = (result[complianceStatus.id] || 0) + 1;
      }
      const generalLiability = complianceStatus.requirements.find((requirement) => requirement.id === 'general_liability');
      if (generalLiability) {
        const key = generalLiability.satisfied ? 'liability-compliant' : 'liability-non-compliant';
        result[key] += 1;
      }
    });
    return result;
  }, [activityFilter, subcontractorRoster]);

  return (
    <section className="panel native-panel workspace-page top-level-certificates-page">
      <div className="panel-actions certificates-page-actions">
        <button className="button secondary" type="button" onClick={() => void refreshCertificates()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        {canEdit ? (
          <>
            <label
              className={`button secondary certificate-bulk-upload-button${!subcontractors.length ? ' disabled' : ''}`}
              aria-disabled={!subcontractors.length}
            >
              Bulk upload &amp; extract
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                multiple
                disabled={!subcontractors.length || bulkProcessing || bulkSaving}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = '';
                  void startBulkUpload(files);
                }}
              />
            </label>
            <button className="button primary" type="button" onClick={() => startCreate()} disabled={!eligibleSubcontractors.length}>
              Add certificate
            </button>
            <label
              className={`compliance-upload-drop-zone${complianceDropActive ? ' is-drag-over' : ''}${complianceUploadBusy ? ' is-busy' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!complianceUploadBusy) setComplianceDropActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                if (!complianceUploadBusy) setComplianceDropActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setComplianceDropActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setComplianceDropActive(false);
                if (!complianceUploadBusy) void handleComplianceFiles(event.dataTransfer.files);
              }}
            >
              <strong>{complianceUploadBusy ? 'Identifying document...' : 'Drop a compliance document here'}</strong>
              <span>or choose a PDF or image · type is identified first</span>
              <input
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                disabled={complianceUploadBusy}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = '';
                  void handleComplianceFiles(files);
                }}
              />
            </label>
          </>
        ) : null}
      </div>

      <div className="compliance-summary-tabs" aria-label="Subcontractor compliance summary">
        {[
          ['All subcontractors', stats.total, 'all'],
          ['Compliant', stats.compliant, 'compliant'],
          ['Needs attention', stats['needs-attention'], 'needs-attention'],
          ['Liability compliant', stats['liability-compliant'], 'liability-compliant'],
          ['Liability non-compliant', stats['liability-non-compliant'], 'liability-non-compliant'],
          ['Expired / expiring', stats.expired + stats.expiring, 'expired-expiring'],
        ].map(([label, count, id]) => (
          <button
            className={`compliance-summary-tab status-${id}${statusFilter === id ? ' active' : ''}`}
            type="button"
            key={id}
            onClick={() => setStatusFilter(id)}
          >
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
        <button
          className={`compliance-summary-tab status-inactive${activityFilter === 'inactive' ? ' active' : ''}`}
          type="button"
          onClick={() => {
            setActivityFilter('inactive');
            setStatusFilter('all');
          }}
        >
          <span>Inactive</span>
          <strong>{stats.inactive}</strong>
        </button>
      </div>

      <div className="workspace-control-grid">
        <section className="workspace-section workspace-control-card workspace-control-card-wide">
          <div className="certificate-toolbar">
            <label className="task-filter">
              <span>Active / inactive</span>
              <select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
                <option value="active">Active subcontractors</option>
                <option value="inactive">Inactive subcontractors</option>
                <option value="all">All subcontractors</option>
              </select>
            </label>
            <label className="task-filter">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="compliant">Compliant</option>
                <option value="needs-attention">Needs attention</option>
                <option value="liability-compliant">Liability compliant</option>
                <option value="liability-non-compliant">Liability non-compliant</option>
                <option value="expired-expiring">Expired / expiring</option>
                <option value="active">Active</option>
                <option value="expiring">Expiring soon</option>
                <option value="expired">Expired</option>
                <option value="missing">Missing</option>
              </select>
            </label>
            <label className="task-filter">
              <span>Subcontractor</span>
              <select value={subcontractorFilter} onChange={(event) => setSubcontractorFilter(event.target.value)}>
                <option value="all">All subcontractors</option>
                {subcontractors.map((subcontractor) => (
                  <option key={subcontractor.id} value={subcontractor.id}>{subcontractorLabel(subcontractor)}</option>
                ))}
              </select>
            </label>
            <label className="task-filter certificate-search-field">
              <span>Search subcontractors</span>
              <input className="task-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Subcontractor, insurer, policy, or coverage" />
            </label>
          </div>
        </section>
      </div>

      <section className="workspace-section">
        {loadError ? (
          <div className="empty-state">
            <h3>Compliance is unavailable</h3>
            <p>{loadError}</p>
            <button className="button secondary" type="button" onClick={() => void refreshCertificates()}>Try again</button>
          </div>
        ) : loading ? (
          <div className="empty-state compact" role="status"><h3>Loading compliance</h3></div>
        ) : !subcontractors.length ? (
          <div className="empty-state">
            <h3>Add a subcontractor first</h3>
            <p>Every insurance certificate must be linked to a subcontractor People record.</p>
          </div>
        ) : filteredRoster.length ? (
          <div className="compliance-list" role="table" aria-label="Subcontractor compliance register">
            <div className="compliance-list-header" role="row">
              <span>Subcontractor</span>
              <span>General Liability</span>
              <span>Workers Comp</span>
              <span>Agreement</span>
              <span>Form W-9</span>
              <span>Status</span>
            </div>
            {filteredRoster.map(({ subcontractor, certificates: subcontractorCertificates, documents: subcontractorDocuments, complianceStatus }) => {
              const updatingSubcontractor = subcontractorSavingId === subcontractor.id;
              const subcontractorRenewals = renewalRequestsBySubcontractor.get(subcontractor.id) || [];
              const latestRenewal = subcontractorRenewals[0] || null;
              const renewalRequested = latestRenewal?.status === 'requested'
                && latestRenewal?.deliveryStatus === 'sent';
              const complianceRequestedRequirements = new Set(
                Array.isArray(subcontractor.complianceRequestedRequirements)
                  ? subcontractor.complianceRequestedRequirements
                  : [],
              );
              const updatingRenewal = renewalSavingId === subcontractor.id;
              const sendingComplianceEmail = complianceEmailSendingId === subcontractor.id;
              const savingSubcontractorEmail = complianceEmailSavingId === subcontractor.id;
              const hasSubcontractorEmail = Boolean(String(subcontractor.email || '').trim());
              const latestCertificate = subcontractorCertificates[0] || null;
              const requirementsById = new Map(complianceStatus.requirements.map((requirement) => [requirement.id, requirement]));
              return (
                <details
                  className={`compliance-list-item status-${complianceStatus.id}`}
                  key={subcontractor.id}
                  open={expandedSubcontractorIds.has(subcontractor.id)}
                  onToggle={(event) => {
                    const nextOpen = event.currentTarget.open;
                    setExpandedSubcontractorIds((current) => {
                      if (current.has(subcontractor.id) === nextOpen) return current;
                      const next = new Set(current);
                      if (nextOpen) next.add(subcontractor.id);
                      else next.delete(subcontractor.id);
                      return next;
                    });
                  }}
                >
                  <summary className="compliance-list-summary" role="row">
                    <div className="compliance-list-identity" role="cell">
                      <h3>{subcontractorLabel(subcontractor)}</h3>
                      <p>
                        {subcontractorCertificates.length
                          ? `${subcontractorCertificates.length} certificate${subcontractorCertificates.length === 1 ? '' : 's'} on file`
                          : 'No certificate on file'}
                      </p>
                    </div>
                    {[
                      ['general_liability', 'General Liability'],
                      ['workers_compensation', 'Workers Comp'],
                      ['subcontractor_agreement', 'Agreement'],
                      ['w9', 'Form W-9'],
                    ].map(([requirementId, requirementLabel]) => {
                      const requirement = requirementsById.get(requirementId);
                      const requested = requirementId === 'general_liability'
                        ? renewalRequested || (!requirement?.satisfied && complianceRequestedRequirements.has(requirementId))
                        : !requirement?.satisfied && complianceRequestedRequirements.has(requirementId);
                      return (
                        <span
                          className={`compliance-list-status${requested ? ' requested' : requirement?.optional ? ' optional' : requirement?.satisfied ? ' satisfied' : ' missing'}`}
                          role="cell"
                          data-label={requirementLabel}
                          aria-label={`${requirementLabel}: ${complianceStatus.id === 'inactive' ? 'Inactive' : requested ? `Requested · ${requirement?.detail || 'Missing'}` : requirement?.optional ? `${requirement.detail} (optional)` : requirement?.detail || 'Missing'}`}
                          key={requirementId}
                        >
                          <span aria-hidden="true" title={requested ? 'Requested' : undefined}>
                            {requested ? <FluentIcon name="mail" size={13} /> : complianceStatus.id === 'inactive' || requirement?.optional ? '—' : requirement?.satisfied ? '✓' : '!'}
                          </span>
                          <small>{complianceStatus.id === 'inactive' ? 'Inactive' : requirement?.optional ? `${requirement.detail} · Optional` : requirement?.detail || 'Missing'}</small>
                        </span>
                      );
                    })}
                    <span className={`certificate-status-badge status-${complianceStatus.id}`} role="cell">{complianceStatus.label}</span>
                  </summary>

                  <div className="compliance-list-detail">

                  {latestRenewal ? (
                    <section className="certificate-renewal-panel" aria-label={`Certificate renewal for ${subcontractorLabel(subcontractor)}`}>
                      <div className="certificate-renewal-summary">
                        <div>
                          <span>Latest renewal request</span>
                          <strong>{RENEWAL_STATUS_LABELS[latestRenewal.status] || latestRenewal.status}</strong>
                        </div>
                        <div>
                          <span>Requested</span>
                          <strong>{formatDisplayDateTime(latestRenewal.requestedAt)}</strong>
                        </div>
                        <div>
                          <span>Email delivery</span>
                          <strong>{latestRenewal.deliveryStatus === 'sent' ? 'Sent' : latestRenewal.deliveryStatus === 'pending' ? 'Pending' : 'Needs follow-up'}</strong>
                        </div>
                      </div>
                      <details className="certificate-renewal-history">
                        <summary>Renewal history ({subcontractorRenewals.length})</summary>
                        <div>
                          {subcontractorRenewals.map((renewal) => (
                            <p key={renewal.id}>
                              <strong>{RENEWAL_STATUS_LABELS[renewal.status] || renewal.status}</strong>
                              <span>{formatDisplayDateTime(renewal.requestedAt)} · {renewal.recipientEmail} · Email {renewal.deliveryStatus}</span>
                            </p>
                          ))}
                        </div>
                      </details>
                    </section>
                  ) : null}

                  {complianceStatus.id !== 'inactive' ? (
                    <section className="compliance-document-list" aria-label="Required compliance documents">
                      {[
                        ['subcontractor_agreement', 'Subcontractor agreement'],
                        ['w9', 'Form W-9'],
                      ].map(([documentType, label]) => {
                        const document = subcontractorDocuments.find((item) => item.documentType === documentType) || null;
                        const key = `${subcontractor.id}:${documentType}`;
                        const savingDocument = complianceSavingKey === key;
                        const exempt = documentType === 'w9' && subcontractor.is1099Exempt === true;
                        const taxIdStatus = documentType === 'w9' ? taxIdStatusBySubcontractor.get(subcontractor.id) || null : null;
                        return (
                          <div className={`compliance-document-row${document || exempt ? ' complete' : ' missing'}`} key={documentType}>
                            <div>
                              <strong>{label}</strong>
                              <span>{exempt
                                ? 'W-9 exempt'
                                : document
                                  ? 'On file'
                                  : 'Required document missing'}</span>
                              {documentType === 'w9' && !exempt ? (
                                <>
                                  <span>{taxIdStatus?.taxIdLastFour
                                    ? `Tax ID ${maskedTaxId(taxIdStatus.taxIdLastFour)}`
                                    : 'Tax ID not captured'}</span>
                                  {taxIdStatus?.legalName || taxIdStatus?.businessName ? (
                                    <span>W-9 name: {[taxIdStatus.legalName, taxIdStatus.businessName].filter(Boolean).join(' · ')}</span>
                                  ) : null}
                                  {taxIdStatus?.mailingAddress ? <span>Address: {taxIdStatus.mailingAddress}</span> : null}
                                  {subcontractor.companyType ? <span>Company Type: {subcontractor.companyType}</span> : null}
                                </>
                              ) : null}
                            </div>
                            {!exempt ? (
                              <>
                                {canEdit && documentType === 'w9' ? (
                                  <label className="compliance-tax-id-entry">
                                    <span>Tax ID</span>
                                    <input
                                      type="password"
                                      inputMode="numeric"
                                      autoComplete="off"
                                      maxLength={11}
                                      value={complianceTaxIdDrafts[key] || ''}
                                      onChange={(event) => setComplianceTaxIdDrafts((current) => ({ ...current, [key]: event.target.value }))}
                                      placeholder="9-digit EIN or SSN"
                                      aria-label={`Tax ID for ${subcontractorLabel(subcontractor)}`}
                                      disabled={savingDocument}
                                    />
                                    <small>Encrypted in storage. Only the last four digits are shown.</small>
                                  </label>
                                ) : null}
                                <div className="compliance-document-actions">
                                  {canEdit && documentType === 'w9' && document && complianceTaxIdDrafts[key] ? (
                                    <button className="button secondary" type="button" disabled={savingDocument} onClick={() => void saveManualTaxId(subcontractor)}>
                                      Save tax ID
                                    </button>
                                  ) : null}
                                  {document ? (
                                    <button className="button secondary" type="button" onClick={() => void downloadFileWithUi(sourceFile(document), { fileName: document.sourceFileName })}>
                                      Open file
                                    </button>
                                  ) : null}
                                  {canEdit ? (
                                    <>
                                      <label className={`button secondary${savingDocument ? ' disabled' : ''}`}>
                                        {savingDocument ? 'Saving...' : document ? 'Replace file' : 'Upload signed file'}
                                        <input
                                          type="file"
                                          accept=".pdf,image/jpeg,image/png,image/webp"
                                          disabled={savingDocument}
                                          onChange={(event) => {
                                            const file = event.target.files?.[0] || null;
                                            event.target.value = '';
                                            void saveComplianceDocument(subcontractor, documentType, file);
                                          }}
                                        />
                                      </label>
                                      {document ? (
                                        <button className="button secondary danger" type="button" disabled={savingDocument} onClick={() => void removeComplianceDocument(document)}>
                                          Remove
                                        </button>
                                      ) : null}
                                    </>
                                  ) : null}
                                </div>
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                    </section>
                  ) : null}

                  {subcontractorCertificates.length ? (
                    <div className="certificate-record-list">
                      {subcontractorCertificates.map((certificate) => {
                        const recordStatus = certificateStatus(certificate.expirationDate);
                        const coverageExpanded = expandedCoverageIds.has(certificate.id);
                        const coverageRegionId = `certificate-coverages-${certificate.id}`;
                        return (
                          <section className={`certificate-record${certificate.additionalInsured ? '' : ' additional-insured-missing'}`} key={certificate.id}>
                            <div className="certificate-record-heading">
                              <div>
                                <strong>{certificate.insurer || 'Insurance company not entered'}</strong>
                                <span>{certificate.policyNumber || 'Policy number not entered'}</span>
                              </div>
                              <span className={`certificate-status-badge status-${recordStatus.id}`}>{recordStatus.label}</span>
                            </div>
                            <div className="certificate-card-grid">
                              <div>
                                <span>Liability dates</span>
                                <strong>{coverageDateRange(certificate, ['general liability', 'commercial general liability'], true)}</strong>
                              </div>
                              <div>
                                <span>Workers comp dates</span>
                                <strong>{coverageDateRange(certificate, [
                                  'workers compensation',
                                  'workers comp',
                                  'workmans compensation',
                                  'workmens compensation',
                                ])}</strong>
                              </div>
                              <div><span>Additional insured</span><strong>{certificate.additionalInsured ? 'Yes' : 'No'}</strong></div>
                            </div>
                            <button
                              className="certificate-coverage-toggle"
                              type="button"
                              aria-expanded={coverageExpanded}
                              aria-controls={coverageRegionId}
                              onClick={() => setExpandedCoverageIds((current) => {
                                const next = new Set(current);
                                if (next.has(certificate.id)) next.delete(certificate.id);
                                else next.add(certificate.id);
                                return next;
                              })}
                            >
                              {coverageExpanded ? 'Hide coverage details' : `Show coverage details (${certificate.coverages.length})`}
                            </button>
                            {coverageExpanded ? (
                              <div className="certificate-coverage-table-wrap" id={coverageRegionId}>
                                <table className="certificate-coverage-table" aria-label="Insurance coverage details">
                                  <thead>
                                    <tr>
                                      <th scope="col">Coverage</th>
                                      <th scope="col">General</th>
                                      <th scope="col">Aggregate</th>
                                      <th scope="col">Effective</th>
                                      <th scope="col">Expires</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {certificate.coverages.map((coverage) => (
                                      <tr key={coverage.id}>
                                        <th scope="row">{coverage.type}</th>
                                        <td>{formatCurrency(coverage.generalLimit)}</td>
                                        <td>{formatCurrency(coverage.aggregateLimit)}</td>
                                        <td>{formatDisplayDate(coverage.effectiveDate)}</td>
                                        <td>{formatDisplayDate(coverage.expirationDate)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : null}
                            <div className="certificate-card-actions">
                              {certificate.sourcePath ? (
                                <button className="button secondary" type="button" onClick={() => void downloadFileWithUi(sourceFile(certificate), { fileName: certificate.sourceFileName })}>
                                  Open file
                                </button>
                              ) : null}
                              {canEdit ? (
                                <>
                                  <button className="button secondary" type="button" onClick={() => startEdit(certificate)}>Edit</button>
                                  <button className="button secondary danger" type="button" onClick={() => void handleDelete(certificate)}>Delete</button>
                                </>
                              ) : null}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="certificate-roster-empty">No certificate has been added for this subcontractor.</p>
                  )}

                  {canEdit ? (
                    <div className="certificate-roster-actions">
                      {!hasSubcontractorEmail ? (
                        <div className="compliance-inline-email">
                          <label>
                            <span>Email address</span>
                            <input
                              type="email"
                              value={complianceEmailDrafts[subcontractor.id] || ''}
                              onChange={(event) => setComplianceEmailDrafts((current) => ({
                                ...current,
                                [subcontractor.id]: event.target.value,
                              }))}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveSubcontractorEmail(subcontractor);
                                }
                              }}
                              placeholder="subcontractor@example.com"
                              aria-label={`Email address for ${subcontractorLabel(subcontractor)}`}
                              disabled={savingSubcontractorEmail}
                            />
                          </label>
                          <button
                            className={`button secondary${savingSubcontractorEmail ? ' is-loading' : ''}`}
                            type="button"
                            disabled={savingSubcontractorEmail || !String(complianceEmailDrafts[subcontractor.id] || '').trim()}
                            onClick={() => void saveSubcontractorEmail(subcontractor)}
                          >
                            {savingSubcontractorEmail ? 'Saving...' : 'Save email'}
                          </button>
                        </div>
                      ) : null}
                      {complianceStatus.id === 'needs-attention' && hasSubcontractorEmail ? (
                        <button
                          className={`button secondary${sendingComplianceEmail ? ' is-loading' : ''}`}
                          type="button"
                          disabled={sendingComplianceEmail}
                          aria-busy={sendingComplianceEmail}
                          onClick={() => void requestSubcontractorCompliance(subcontractor, complianceStatus)}
                        >
                          {sendingComplianceEmail ? 'Sending...' : 'Email compliance request'}
                        </button>
                      ) : null}
                      {certificateEligible(subcontractor) && hasSubcontractorEmail ? (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={updatingRenewal}
                          onClick={() => void requestCertificateRenewal(subcontractor, latestCertificate)}
                        >
                          {updatingRenewal ? 'Working...' : 'Request renewal'}
                        </button>
                      ) : null}
                      {latestRenewal && RENEWAL_NEXT_STATUS[latestRenewal.status] ? (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={updatingRenewal}
                          onClick={() => void advanceCertificateRenewal(latestRenewal)}
                        >
                          Mark {RENEWAL_STATUS_LABELS[RENEWAL_NEXT_STATUS[latestRenewal.status]]}
                        </button>
                      ) : null}
                      {!subcontractor.companyType ? (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={updatingSubcontractor}
                          onClick={() => void updateSubcontractorCompliance(subcontractor, {
                            is1099Exempt: subcontractor.is1099Exempt !== true,
                          })}
                        >
                          {subcontractor.is1099Exempt ? 'Remove W-9 exemption' : 'Mark W-9 exempt'}
                        </button>
                      ) : null}
                      <button
                        className="button secondary"
                        type="button"
                        disabled={updatingSubcontractor}
                        onClick={() => void updateSubcontractorCompliance(subcontractor, {
                          inactive: subcontractor.inactive !== true,
                        })}
                      >
                        {subcontractor.inactive ? 'Reactivate' : 'Mark inactive'}
                      </button>
                      {certificateEligible(subcontractor) ? (
                        <button className="button primary" type="button" onClick={() => startCreate(subcontractor.id)} disabled={updatingSubcontractor}>
                          Add certificate
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No subcontractors found</h3>
            <p>Change the filters or search term to see subcontractors.</p>
          </div>
        )}
      </section>

      {draft ? (
        <CertificateModal
          draft={draft}
          subcontractors={subcontractors}
          file={selectedFile}
          busy={saving}
          extracting={extracting}
          onChange={updateDraft}
          onCoverageChange={updateCoverage}
          onAddCoverage={() => setDraft((current) => ({ ...current, coverages: [...current.coverages, { ...EMPTY_COVERAGE, id: newId(), type: '', generalLimit: '', aggregateLimit: '' }] }))}
          onRemoveCoverage={(index) => setDraft((current) => ({ ...current, coverages: current.coverages.filter((_, coverageIndex) => coverageIndex !== index) }))}
          onFileChange={(file) => void selectFile(file)}
          onExtract={() => void handleExtract()}
          onSelectAndExtract={(file) => void handleExtract(file)}
          onClose={() => void closeModal()}
          onSave={() => void handleSave()}
        />
      ) : null}
      {bulkOpen ? (
        <BulkCertificateModal
          items={bulkItems}
          subcontractors={subcontractors}
          processing={bulkProcessing}
          saving={bulkSaving}
          onSubcontractorChange={(itemId, subcontractorId) => updateBulkItem(itemId, (item) => ({
            draft: { ...item.draft, subcontractorId },
            error: '',
          }))}
          onRetry={(item) => void retryBulkItem(item)}
          onRemove={(item) => void removeBulkItem(item)}
          onClose={() => void closeBulkModal()}
          onSave={() => void handleBulkSave()}
        />
      ) : null}
      {complianceUpload ? (
        <ComplianceUploadRoutingModal
          upload={complianceUpload}
          subcontractors={subcontractors}
          busy={complianceUploadBusy}
          onChange={(key, value) => setComplianceUpload((current) => current ? { ...current, [key]: value, error: '' } : current)}
          onClose={() => void closeComplianceUpload()}
          onContinue={() => void continueComplianceUpload()}
        />
      ) : null}
    </section>
  );
}
