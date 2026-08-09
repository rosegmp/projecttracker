import React, { useEffect, useMemo, useState } from 'react';
import { renderModalPortal, showAppAlert, showAppConfirm } from './AppDialogs.jsx';
import { downloadFileWithUi } from '../utils/downloadUi.js';
import { formatFileSize } from '../utils/fileUi.js';
import { findClosestSubcontractor } from '../utils/certificateMatching.js';
import {
  certificateEligible,
  certificateMatchesStatusFilter,
  certificateRequired,
  certificateStatus,
  sortCertificatesByExpiration,
  subcontractorCertificateStatus,
  subcontractorLabel,
} from '../utils/certificateStatus.js';
import { reportError } from '../services/observability.js';
import { updatePerson } from '../services/trackerData.js';
import {
  deleteCertificateFile,
  deleteInsuranceCertificate,
  extractInsuranceCertificate,
  loadInsuranceCertificates,
  saveInsuranceCertificate,
  uploadCertificateFile,
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
                const suffix = subcontractor.inactive
                  ? ' (Inactive)'
                  : !certificateRequired(subcontractor) ? ' (No cert needed)' : '';
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
                          {subcontractor.inactive ? ' (Inactive)' : !certificateRequired(subcontractor) ? ' (No cert needed)' : ''}
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [subcontractorFilter, setSubcontractorFilter] = useState('all');
  const [draft, setDraft] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [originalCertificate, setOriginalCertificate] = useState(null);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [expandedCoverageIds, setExpandedCoverageIds] = useState(() => new Set());
  const [subcontractorSavingId, setSubcontractorSavingId] = useState('');
  const [bulkItems, setBulkItems] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);

  async function refreshCertificates() {
    setLoading(true);
    setLoadError('');
    try {
      setCertificates(await loadInsuranceCertificates());
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
    setStatusFilter(navigationTarget.statusId || 'all');
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

  const subcontractorRoster = useMemo(() => {
    const certificatesBySubcontractor = new Map();
    certificates.forEach((certificate) => {
      if (!certificatesBySubcontractor.has(certificate.subcontractorId)) {
        certificatesBySubcontractor.set(certificate.subcontractorId, []);
      }
      certificatesBySubcontractor.get(certificate.subcontractorId).push(certificate);
    });
    return subcontractors.map((subcontractor) => {
      const subcontractorCertificates = sortCertificatesByExpiration(
        certificatesBySubcontractor.get(subcontractor.id) || [],
      );
      return {
        subcontractor,
        certificates: subcontractorCertificates,
        status: subcontractorCertificateStatus(subcontractor, subcontractorCertificates),
      };
    });
  }, [certificates, subcontractors]);

  const filteredRoster = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return subcontractorRoster.filter(({ subcontractor, certificates: subcontractorCertificates, status }) => {
      if (!certificateMatchesStatusFilter(status.id, statusFilter)) return false;
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
  }, [search, statusFilter, subcontractorFilter, subcontractorRoster]);

  const stats = useMemo(() => {
    const result = {
      total: subcontractorRoster.length,
      active: 0,
      expiring: 0,
      expired: 0,
      missing: 0,
      'not-required': 0,
      inactive: 0,
    };
    subcontractorRoster.forEach(({ status }) => {
      result[status.id] += 1;
    });
    return result;
  }, [subcontractorRoster]);

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
          </>
        ) : null}
      </div>

      <div className="certificate-stats-grid" aria-label="Certificate status summary">
        {[
          ['All subcontractors', stats.total, 'all'],
          ['Expired / expiring', stats.expired + stats.expiring, 'expired-expiring'],
          ['Active', stats.active, 'active'],
          ['Expiring soon', stats.expiring, 'expiring'],
          ['Expired', stats.expired, 'expired'],
          ['Missing', stats.missing, 'missing'],
          ['No cert needed', stats['not-required'], 'not-required'],
          ['Inactive', stats.inactive, 'inactive'],
        ].map(([label, count, id]) => (
          <button className={`certificate-stat-card status-${id}${statusFilter === id ? ' active' : ''}`} type="button" key={id} onClick={() => setStatusFilter(id)}>
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>

      <div className="workspace-control-grid">
        <section className="workspace-section workspace-control-card workspace-control-card-wide">
          <div className="certificate-toolbar">
            <label className="task-filter">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="expired-expiring">Expired / expiring</option>
                <option value="active">Active</option>
                <option value="expiring">Expiring soon</option>
                <option value="expired">Expired</option>
                <option value="missing">Missing</option>
                <option value="not-required">No cert needed</option>
                <option value="inactive">Inactive</option>
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
            <h3>Certificates are unavailable</h3>
            <p>{loadError}</p>
            <button className="button secondary" type="button" onClick={() => void refreshCertificates()}>Try again</button>
          </div>
        ) : loading ? (
          <div className="empty-state compact" role="status"><h3>Loading certificates</h3></div>
        ) : !subcontractors.length ? (
          <div className="empty-state">
            <h3>Add a subcontractor first</h3>
            <p>Every insurance certificate must be linked to a subcontractor People record.</p>
          </div>
        ) : filteredRoster.length ? (
          <div className="certificate-list">
            {filteredRoster.map(({ subcontractor, certificates: subcontractorCertificates, status }) => {
              const updatingSubcontractor = subcontractorSavingId === subcontractor.id;
              return (
                <article className={`certificate-card certificate-roster-card status-${status.id}`} key={subcontractor.id}>
                  <div className="certificate-card-header">
                    <div>
                      <p className="eyebrow">Subcontractor</p>
                      <h3>{subcontractorLabel(subcontractor)}</h3>
                      <p>
                        {subcontractorCertificates.length
                          ? `${subcontractorCertificates.length} certificate${subcontractorCertificates.length === 1 ? '' : 's'} on file`
                          : 'No certificate on file'}
                      </p>
                    </div>
                    <span className={`certificate-status-badge status-${status.id}`}>{status.label}</span>
                  </div>

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
                      <button
                        className="button secondary"
                        type="button"
                        disabled={updatingSubcontractor}
                        onClick={() => void updateSubcontractorCompliance(subcontractor, {
                          certificateRequirement: certificateRequired(subcontractor) ? 'not_required' : 'required',
                        })}
                      >
                        {certificateRequired(subcontractor) ? 'No cert needed' : 'Require certificate'}
                      </button>
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
                </article>
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
    </section>
  );
}
