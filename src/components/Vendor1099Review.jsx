import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadWorkflowItemsForProjects } from '../services/constructionWorkflows.js';
import { loadVendor1099Import, replaceVendor1099Import, setVendor1099ImportMatch } from '../services/vendor1099Imports.js';
import { createVendor1099FilingBatch, downloadVendor1099PreparationCsv, loadVendor1099FilingWorkspace, requestVendor1099ElectronicConsent, saveVendor1099PayerProfile, sendVendor1099RecipientCopy, updateVendor1099FilingStatus, uploadVendor1099RecipientPdf } from '../services/vendor1099Filing.js';
import { deliverBlob } from '../platform/platformAdapter.js';
import { buildVendor1099Review } from '../utils/vendorReporting.js';
import { showAppConfirm } from './AppDialogs.jsx';
import FluentIcon from './FluentIcon.jsx';

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function yearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, index) => current - index);
}

function subcontractorName(subcontractor) {
  return subcontractor.company || `${subcontractor.first || ''} ${subcontractor.last || ''}`.trim() || 'Unnamed subcontractor';
}

function toReviewVendor(row) {
  return {
    importRowId: row.id || `row-${row.sourceRow}-${row.vendorName}`,
    displayName: row.vendorName,
    subcontractorId: row.subcontractorId,
    directTotal: row.reportableTotal,
    excludedMethodTotal: 0,
    transactionCount: 0,
  };
}

export default function Vendor1099Review({ data, subcontractors, documents, taxIdStatuses, activeUser }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [commitments, setCommitments] = useState([]);
  const [importedRows, setImportedRows] = useState([]);
  const [draftRows, setDraftRows] = useState([]);
  const [draftFile, setDraftFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [message, setMessage] = useState('');
  const [filingWorkspace, setFilingWorkspace] = useState({ payer: null, batches: [] });
  const [filingBusy, setFilingBusy] = useState(false);
  const [payerOpen, setPayerOpen] = useState(false);
  const [payerDraft, setPayerDraft] = useState({ legalName: '', businessName: '', mailingAddress: '', phone: '', contactEmail: '', taxId: '' });
  const [expandedBatchId, setExpandedBatchId] = useState('');
  const [uploadFormId, setUploadFormId] = useState('');
  const fileInputRef = useRef(null);
  const recipientPdfInputRef = useRef(null);
  const projectIds = useMemo(() => (data?.projects || []).map((project) => project.id).filter(Boolean), [data?.projects]);
  const canManageImports = activeUser?.role === 'Admin';

  async function loadYearData(selectedYear = year) {
    setLoading(true);
    setMessage('');
    try {
      const [nextCommitments, nextImport] = await Promise.all([
        loadWorkflowItemsForProjects('commitments', projectIds),
        canManageImports ? loadVendor1099Import(selectedYear) : Promise.resolve([]),
      ]);
      setCommitments(nextCommitments);
      setImportedRows(nextImport);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load vendor payments.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadYearData(year); }, [projectIds, year, canManageImports]);

  useEffect(() => {
    if (!canManageImports) return;
    let active = true;
    loadVendor1099FilingWorkspace().then((workspace) => {
      if (!active) return;
      setFilingWorkspace({ payer: workspace.payer || null, batches: workspace.batches || [] });
      setPayerDraft((current) => ({ ...current,
        legalName: workspace.payer?.legalName || '', businessName: workspace.payer?.businessName || '',
        mailingAddress: workspace.payer?.mailingAddress || '', phone: workspace.payer?.phone || '',
        contactEmail: workspace.payer?.contactEmail || '', taxId: '',
      }));
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Unable to load filing setup.'); });
    return () => { active = false; };
  }, [canManageImports]);

  async function selectSpreadsheet(file) {
    if (!file) return;
    setImportBusy(true);
    setMessage('');
    try {
      const { parseVendor1099Spreadsheet, suggestVendor1099Matches } = await import('../utils/vendor1099Spreadsheet.js');
      const parsed = await parseVendor1099Spreadsheet(file);
      setDraftRows(suggestVendor1099Matches(parsed, subcontractors, taxIdStatuses));
      setDraftFile(file);
    } catch (error) {
      setDraftRows([]);
      setDraftFile(null);
      setMessage(error instanceof Error ? error.message : 'Unable to read the 1099 spreadsheet.');
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function saveImport() {
    if (!draftFile || !draftRows.length) return;
    const unmatched = draftRows.filter((row) => !row.subcontractorId);
    if (unmatched.length && !await showAppConfirm(`${unmatched.length} spreadsheet vendor${unmatched.length === 1 ? '' : 's'} are not matched. They will be saved for review but excluded from Project Hub totals until matched. Continue?`, { title: 'Import unmatched vendors?', confirmLabel: 'Import spreadsheet' })) return;
    if (importedRows.length && !await showAppConfirm(`Replace the existing ${year} spreadsheet import with ${draftFile.name}?`, { title: 'Replace 1099 import?', confirmLabel: 'Replace import', tone: 'danger' })) return;
    setImportBusy(true);
    setMessage('');
    try {
      const saved = await replaceVendor1099Import(year, draftFile.name, draftRows);
      setImportedRows(saved);
      setDraftRows([]);
      setDraftFile(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save the 1099 spreadsheet import.');
    } finally {
      setImportBusy(false);
    }
  }

  async function saveVendorMatch(row, subcontractorId) {
    setImportBusy(true);
    setMessage('');
    try {
      const updated = await setVendor1099ImportMatch(row.id, subcontractorId);
      setImportedRows((current) => current.map((item) => item.id === row.id ? updated : item));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save the imported vendor match.');
    } finally {
      setImportBusy(false);
    }
  }

  async function savePayerProfile(event) {
    event.preventDefault();
    setFilingBusy(true);
    setMessage('');
    try {
      const result = await saveVendor1099PayerProfile(payerDraft);
      setFilingWorkspace((current) => ({ ...current, payer: result.payer }));
      setPayerDraft((current) => ({ ...current, taxId: '' }));
      setPayerOpen(false);
      setMessage('Payer filing profile saved. The complete EIN remains encrypted and is never returned to this page.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save the payer profile.');
    } finally {
      setFilingBusy(false);
    }
  }

  const spreadsheetVendors = useMemo(() => importedRows.map(toReviewVendor), [importedRows]);
  const review = useMemo(() => buildVendor1099Review({
    subcontractors, documents, taxIdStatuses, commitments, importedVendors: spreadsheetVendors,
    paymentSource: importedRows.length ? 'spreadsheet' : 'commitments', year,
  }), [commitments, documents, importedRows.length, spreadsheetVendors, subcontractors, taxIdStatuses, year]);
  const summary = useMemo(() => review.rows.reduce((result, row) => ({
    total: result.total + row.reportableAmount,
    ready: result.ready + (row.status === 'ready' ? 1 : 0),
    attention: result.attention + (row.status === 'needs-attention' || row.status === 'review' ? 1 : 0),
    unallocated: result.unallocated + row.unallocatedTotal,
  }), { total: 0, ready: 0, attention: 0, unallocated: 0 }), [review.rows]);
  const importMeta = importedRows[0] || null;
  const readyRows = review.rows.filter((row) => row.status === 'ready');
  const currentBatches = (filingWorkspace.batches || []).filter((batch) => Number(batch.taxYear) === Number(year));

  async function createFilingBatch() {
    if (!readyRows.length) return;
    if (!await showAppConfirm(`Create an immutable ${year} filing batch for ${readyRows.length} ready vendor${readyRows.length === 1 ? '' : 's'}? Vendor names, addresses, compensation, and encrypted tax IDs will be snapshotted for filing.`, { title: `Create ${year} filing batch?`, confirmLabel: 'Create batch' })) return;
    setFilingBusy(true);
    setMessage('');
    try {
      const result = await createVendor1099FilingBatch(year, readyRows);
      setFilingWorkspace((current) => ({ ...current, batches: [result.batch, ...(current.batches || [])] }));
      setMessage(`Created the ${year} filing batch for ${result.batch.formCount} vendor${result.batch.formCount === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create the filing batch.');
    } finally {
      setFilingBusy(false);
    }
  }

  async function refreshFilingWorkspace(successMessage = '') {
    const workspace = await loadVendor1099FilingWorkspace();
    setFilingWorkspace({ payer: workspace.payer || null, batches: workspace.batches || [] });
    if (successMessage) setMessage(successMessage);
  }

  async function runFilingAction(action, successMessage) {
    setFilingBusy(true); setMessage('');
    try { await action(); await refreshFilingWorkspace(successMessage); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update the filing workspace.'); }
    finally { setFilingBusy(false); }
  }

  async function exportPreparation(batch, jurisdiction) {
    if (!await showAppConfirm(`Download a ${jurisdiction === 'federal' ? 'federal' : 'New Jersey'} preparation CSV containing complete taxpayer IDs? Store it securely. This is not an agency upload file.`, { title: 'Download sensitive preparation file?', confirmLabel: 'Download CSV' })) return;
    await runFilingAction(async () => { const result = await downloadVendor1099PreparationCsv(batch.id, jurisdiction); await deliverBlob(result.blob, result.fileName); }, 'Preparation CSV downloaded. It must be transferred into the official tax-year filing format before submission.');
  }

  async function changeFilingStatus(batch, jurisdiction, status) {
    const confirmation = status === 'submitted' || status === 'accepted' ? window.prompt(`Enter the ${jurisdiction === 'federal' ? 'IRS' : 'New Jersey'} confirmation or acknowledgement number:`) : '';
    if ((status === 'submitted' || status === 'accepted') && confirmation == null) return;
    await runFilingAction(() => updateVendor1099FilingStatus(batch.id, jurisdiction, status, confirmation || ''), `${jurisdiction === 'federal' ? 'Federal' : 'New Jersey'} filing status updated.`);
  }

  async function selectRecipientPdf(file) {
    const formId = uploadFormId; setUploadFormId(''); if (recipientPdfInputRef.current) recipientPdfInputRef.current.value = '';
    if (!file || !formId) return;
    await runFilingAction(() => uploadVendor1099RecipientPdf(formId, file), 'Official recipient PDF stored privately.');
  }

  return (
    <div className="vendor-1099-review">
      <header className="vendor-1099-header">
        <div><p className="eyebrow">Year-end preparation</p><h2>1099 vendor review</h2><p>Upload the QuickBooks 1099 Excel report and review vendor information without storing full tax IDs.</p></div>
        <div className="vendor-1099-actions">
          <label><span>Tax year</span><select value={year} onChange={(event) => { setYear(Number(event.target.value)); setDraftRows([]); setDraftFile(null); }}>{yearOptions().map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
          <button className="button secondary" type="button" onClick={() => void loadYearData(year)} disabled={loading || importBusy}><FluentIcon name="replace" size={16} />{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {canManageImports ? (
        <section className="vendor-1099-import" aria-label="1099 Excel import">
          <div className={`vendor-1099-drop-zone${dropActive ? ' is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDropActive(true); }} onDragOver={(event) => { event.preventDefault(); setDropActive(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }} onDrop={(event) => { event.preventDefault(); setDropActive(false); void selectSpreadsheet(event.dataTransfer.files?.[0]); }}>
            <FluentIcon name="document" size={20} />
            <div><strong>{importMeta ? `${year} import: ${importMeta.sourceFileName || 'Excel spreadsheet'}` : 'Upload QuickBooks 1099 report'}</strong><span>Drop an .xlsx file here or choose a file. Full tax IDs are discarded after matching.</span></div>
            <button className="button secondary" type="button" disabled={importBusy} onClick={() => fileInputRef.current?.click()}>{importMeta ? 'Replace spreadsheet' : 'Choose spreadsheet'}</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(event) => void selectSpreadsheet(event.target.files?.[0])} />
          </div>
          {importMeta ? <p className="vendor-1099-import-meta">Imported {new Date(importMeta.importedAt).toLocaleString()} · {importedRows.length} vendor{importedRows.length === 1 ? '' : 's'}. This spreadsheet replaces local commitment payments for {year}.</p> : null}
        </section>
      ) : null}

      {draftRows.length ? (
        <section className="vendor-1099-import-preview">
          <div className="vendor-1099-import-preview-header"><div><h3>Review {draftFile?.name}</h3><p>Confirm the tax year and vendor matches before saving. The complete tax IDs will not be retained.</p></div><strong>{money(draftRows.reduce((sum, row) => sum + row.reportableTotal, 0))}</strong></div>
          <div className="vendor-1099-import-rows">{draftRows.map((row, index) => (
            <div className="vendor-1099-import-row" key={`${row.sourceRow}-${row.vendorName}`}><div><strong>{row.vendorName}</strong><span>{row.taxIdLastFour ? `Tax ID •••• ${row.taxIdLastFour}` : 'Tax ID not available'} · {money(row.reportableTotal)}</span></div><select aria-label={`Match ${row.vendorName}`} value={row.subcontractorId} onChange={(event) => setDraftRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, subcontractorId: event.target.value, matchReason: event.target.value ? 'manual' : 'unmatched' } : item))}><option value="">Unmatched</option>{subcontractors.map((subcontractor) => <option value={subcontractor.id} key={subcontractor.id}>{subcontractorName(subcontractor)}</option>)}</select><span className={`vendor-1099-match-status is-${row.matchReason}`}>{row.matchReason === 'tax-id' ? 'Matched by Tax ID' : row.matchReason === 'name' ? 'Matched by name' : row.matchReason === 'manual' ? 'Matched manually' : row.matchReason === 'ambiguous' ? 'Review match' : 'Unmatched'}</span></div>
          ))}</div>
          <div className="modal-actions"><button className="button secondary" type="button" disabled={importBusy} onClick={() => { setDraftRows([]); setDraftFile(null); }}>Cancel</button><button className="button primary" type="button" disabled={importBusy} onClick={() => void saveImport()}>{importBusy ? 'Importing…' : `Import ${draftRows.length} vendors`}</button></div>
        </section>
      ) : null}

      <div className="vendor-1099-summary" aria-label={`${year} vendor reporting summary`}><div><span>{importedRows.length ? 'QuickBooks 1099 amount' : 'Eligible direct payments'}</span><strong>{money(summary.total)}</strong></div><div><span>Ready for preparation</span><strong>{summary.ready}</strong></div><div><span>Needs attention</span><strong>{summary.attention}</strong></div><div className={summary.unallocated ? 'is-warning' : ''}><span>Legacy / undated</span><strong>{money(summary.unallocated)}</strong></div></div>

      <div className="vendor-1099-guidance"><FluentIcon name="document" size={18} /><span>{review.threshold == null ? `Confirm the IRS reporting threshold for ${year} before filing.` : `The preparation threshold shown for ${year} is ${money(review.threshold)}.`} {importedRows.length ? 'Amounts come from the uploaded QuickBooks NEC Box 1 report.' : 'Credit-card and third-party-network payments are excluded from the eligible direct-payment total.'} Review the final filing with your tax professional.</span></div>
      {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}
      {review.unlinkedCommitments.length ? <div className="vendor-1099-guidance warning"><FluentIcon name="warning" size={18} /><span>{review.unlinkedCommitments.length} commitment{review.unlinkedCommitments.length === 1 ? '' : 's'} with payments are not linked to a subcontractor and require review.</span></div> : null}
      {review.unmatchedImportedVendors.length ? (
        <section className="quickbooks-vendor-matches"><div><h3>Match imported vendors</h3><p>Amounts remain outside Project Hub totals until the spreadsheet vendor is explicitly matched to a subcontractor.</p></div>{importedRows.filter((row) => !row.subcontractorId).map((row) => (
          <div className="quickbooks-vendor-match-row" key={row.id}><div><strong>{row.vendorName}</strong><span>{money(row.reportableTotal)} · {row.taxIdLastFour ? `Tax ID •••• ${row.taxIdLastFour}` : 'Tax ID unavailable'}</span></div><select aria-label={`Match ${row.vendorName}`} defaultValue="" onChange={(event) => { if (event.target.value) void saveVendorMatch(row, event.target.value); }} disabled={importBusy}><option value="">Select subcontractor</option>{subcontractors.map((subcontractor) => <option value={subcontractor.id} key={subcontractor.id}>{subcontractorName(subcontractor)}</option>)}</select></div>
        ))}</section>
      ) : null}

      {canManageImports ? <section className="vendor-1099-filing" aria-label="1099 filing and delivery">
        <div className="vendor-1099-filing-header"><div><h3>Filing &amp; vendor delivery</h3><p>Create a locked filing snapshot before preparing IRS, New Jersey, or recipient copies.</p></div><div className="vendor-1099-filing-actions"><button className="button secondary" type="button" onClick={() => setPayerOpen((value) => !value)}>{filingWorkspace.payer?.configured ? 'Edit payer profile' : 'Set up payer profile'}</button><button className="button primary" type="button" disabled={filingBusy || !filingWorkspace.payer?.configured || !readyRows.length} onClick={() => void createFilingBatch()}>Create filing batch</button></div></div>
        <div className="vendor-1099-filing-status"><div><span>Payer</span><strong>{filingWorkspace.payer?.configured ? `${filingWorkspace.payer.legalName} · EIN •••• ${filingWorkspace.payer.taxIdLastFour}` : 'Setup required'}</strong></div><div><span>Ready vendors</span><strong>{readyRows.length}</strong></div><div><span>{year} batches</span><strong>{currentBatches.length}</strong></div></div>
        {payerOpen ? <form className="vendor-1099-payer-form" onSubmit={savePayerProfile}>
          <label><span>Legal payer name</span><input required value={payerDraft.legalName} onChange={(event) => setPayerDraft((current) => ({ ...current, legalName: event.target.value }))} /></label>
          <label><span>Business name (optional)</span><input value={payerDraft.businessName} onChange={(event) => setPayerDraft((current) => ({ ...current, businessName: event.target.value }))} /></label>
          <label className="wide"><span>Mailing address</span><input required value={payerDraft.mailingAddress} onChange={(event) => setPayerDraft((current) => ({ ...current, mailingAddress: event.target.value }))} /></label>
          <label><span>Phone</span><input type="tel" value={payerDraft.phone} onChange={(event) => setPayerDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label><span>Contact email</span><input required type="email" value={payerDraft.contactEmail} onChange={(event) => setPayerDraft((current) => ({ ...current, contactEmail: event.target.value }))} /></label>
          <label><span>{filingWorkspace.payer?.taxIdLastFour ? `New EIN (currently •••• ${filingWorkspace.payer.taxIdLastFour})` : 'Payer EIN'}</span><input required={!filingWorkspace.payer?.taxIdLastFour} inputMode="numeric" autoComplete="off" value={payerDraft.taxId} onChange={(event) => setPayerDraft((current) => ({ ...current, taxId: event.target.value }))} placeholder={filingWorkspace.payer?.taxIdLastFour ? 'Leave blank to keep current EIN' : '9 digits'} /></label>
          <div className="modal-actions wide"><button className="button secondary" type="button" onClick={() => setPayerOpen(false)}>Cancel</button><button className="button primary" type="submit" disabled={filingBusy}>{filingBusy ? 'Saving…' : 'Save payer profile'}</button></div>
        </form> : null}
        <input ref={recipientPdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void selectRecipientPdf(event.target.files?.[0])} />
        {currentBatches.length ? <div className="vendor-1099-batches">{currentBatches.map((batch) => {
          const expanded = expandedBatchId === batch.id;
          const federalStatus = batch.forms?.[0]?.federalStatus || 'not_submitted';
          const newJerseyStatus = batch.forms?.[0]?.newJerseyStatus || 'not_submitted';
          return <section className="vendor-1099-batch" key={batch.id}>
            <button className="vendor-1099-batch-summary" type="button" onClick={() => setExpandedBatchId(expanded ? '' : batch.id)} aria-expanded={expanded}><span><strong>{batch.formCount} form{batch.formCount === 1 ? '' : 's'} · {money(batch.totalCompensation)}</strong><small>Created {new Date(batch.createdAt).toLocaleString()}</small></span><span className={`status-pill status-${batch.status === 'accepted' ? 'ready' : 'review'}`}>{batch.status}</span></button>
            {expanded ? <div className="vendor-1099-batch-detail">
              <div className="vendor-1099-jurisdictions">
                <div><strong>Federal · IRS IRIS</strong><span>{federalStatus.replaceAll('_', ' ')}{batch.federalConfirmation ? ` · ${batch.federalConfirmation}` : ''}</span><div><button className="button secondary" type="button" disabled={filingBusy} onClick={() => void exportPreparation(batch, 'federal')}>Preparation CSV</button><select aria-label="Federal filing status" value={federalStatus} disabled={filingBusy} onChange={(event) => void changeFilingStatus(batch, 'federal', event.target.value)}><option value="not_submitted">Not submitted</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="corrected">Corrected</option></select><a className="button secondary" href="https://www.irs.gov/filing/e-file-information-returns-with-iris" target="_blank" rel="noreferrer">Open IRS IRIS</a></div></div>
                <div><strong>New Jersey</strong><span>{newJerseyStatus.replaceAll('_', ' ')}{batch.newJerseyConfirmation ? ` · ${batch.newJerseyConfirmation}` : ''}</span><div><button className="button secondary" type="button" disabled={filingBusy} onClick={() => void exportPreparation(batch, 'new_jersey')}>Preparation CSV</button><select aria-label="New Jersey filing status" value={newJerseyStatus} disabled={filingBusy} onChange={(event) => void changeFilingStatus(batch, 'new_jersey', event.target.value)}><option value="not_submitted">Not submitted</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="corrected">Corrected</option><option value="not_required">Not required</option></select><a className="button secondary" href="https://www.nj.gov/treasury/taxation/businesses/payroll/payroll-filing.shtml" target="_blank" rel="noreferrer">NJ filing options</a></div></div>
              </div>
              <div className="vendor-1099-delivery-list"><div className="vendor-1099-delivery-row heading"><span>Vendor</span><span>Delivery</span><span>Official PDF</span><span>Actions</span></div>{(batch.forms || []).map((form) => <div className="vendor-1099-delivery-row" key={form.id}><span><strong>{form.vendorName}</strong><small>{form.recipientEmail || 'Email missing'} · Tax ID •••• {form.taxIdLastFour}</small></span><span>{String(form.deliveryStatus || 'paper_required').replaceAll('_', ' ')}</span><span>{form.recipientPdfFileName || 'Not uploaded'}</span><span className="vendor-1099-row-actions"><button className="button secondary" type="button" disabled={filingBusy || !form.recipientEmail} onClick={() => void runFilingAction(() => requestVendor1099ElectronicConsent(form.id), `Consent request sent to ${form.vendorName}.`)}>Request consent</button><button className="button secondary" type="button" disabled={filingBusy} onClick={() => { setUploadFormId(form.id); recipientPdfInputRef.current?.click(); }}>Upload PDF</button><button className="button primary" type="button" disabled={filingBusy || !form.consentedAt || !form.recipientPdfFileName} onClick={() => void runFilingAction(() => sendVendor1099RecipientCopy(form.id), `Secure recipient-copy notice sent to ${form.vendorName}.`)}>Send copy</button></span></div>)}</div>
            </div> : null}
          </section>;
        })}</div> : <p className="vendor-1099-import-meta">No filing batch has been created for {year}.</p>}
        <div className="vendor-1099-guidance"><FluentIcon name="lock" size={18} /><span>Federal filing, New Jersey filing, and recipient delivery are tracked independently. Full tax IDs remain server-only. Secure electronic delivery will require each vendor’s affirmative consent; vendors without consent remain marked for paper delivery.</span></div>
      </section> : null}

      {loading ? <div className="empty-state compact"><p>Loading vendor payments…</p></div> : review.rows.length ? (
        <div className="vendor-1099-table-wrap"><table className="vendor-1099-table"><thead><tr><th>Vendor</th><th>Company type</th><th>W-9 / Tax ID</th><th>Mailing address</th><th>{importedRows.length ? 'QuickBooks 1099' : 'Eligible direct'}</th><th>Card / network</th><th>Status</th></tr></thead><tbody>{review.rows.map((row) => (
          <tr key={row.id}><td><strong>{row.displayName}</strong>{row.legalName && row.legalName !== row.displayName ? <small>{row.legalName}</small> : null}{row.inactive ? <small>Inactive</small> : null}</td><td>{row.companyType || 'Not provided'}</td><td><span>{row.hasW9 ? 'W-9 on file' : 'W-9 missing'}</span><small>{row.taxIdLastFour ? `Tax ID •••• ${row.taxIdLastFour}` : 'Tax ID not captured'}</small></td><td>{row.mailingAddress || 'Not captured'}</td><td><strong>{money(row.directTotal)}</strong>{row.unallocatedTotal ? <small className="vendor-1099-warning">{money(row.unallocatedTotal)} undated</small> : null}</td><td>{money(row.excludedMethodTotal)}</td><td><span className={`status-pill status-${row.status}`}>{row.statusLabel}</span>{row.issues.length ? <small>{row.issues.join(' · ')}</small> : null}</td></tr>
        ))}</tbody></table></div>
      ) : <div className="empty-state compact"><h3>No vendor payments for {year}</h3><p>{importedRows.length ? 'No matched spreadsheet vendors have payments for this tax year.' : 'Add dated project commitment payments or upload the QuickBooks 1099 Excel report.'}</p></div>}
    </div>
  );
}
