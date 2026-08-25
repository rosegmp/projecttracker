import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadWorkflowItemsForProjects } from '../services/constructionWorkflows.js';
import { loadVendor1099Import, replaceVendor1099Import, setVendor1099ImportMatch } from '../services/vendor1099Imports.js';
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
  const fileInputRef = useRef(null);
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

      {loading ? <div className="empty-state compact"><p>Loading vendor payments…</p></div> : review.rows.length ? (
        <div className="vendor-1099-table-wrap"><table className="vendor-1099-table"><thead><tr><th>Vendor</th><th>Company type</th><th>W-9 / Tax ID</th><th>Mailing address</th><th>{importedRows.length ? 'QuickBooks 1099' : 'Eligible direct'}</th><th>Card / network</th><th>Status</th></tr></thead><tbody>{review.rows.map((row) => (
          <tr key={row.id}><td><strong>{row.displayName}</strong>{row.legalName && row.legalName !== row.displayName ? <small>{row.legalName}</small> : null}{row.inactive ? <small>Inactive</small> : null}</td><td>{row.companyType || 'Not provided'}</td><td><span>{row.hasW9 ? 'W-9 on file' : 'W-9 missing'}</span><small>{row.taxIdLastFour ? `Tax ID •••• ${row.taxIdLastFour}` : 'Tax ID not captured'}</small></td><td>{row.mailingAddress || 'Not captured'}</td><td><strong>{money(row.directTotal)}</strong>{row.unallocatedTotal ? <small className="vendor-1099-warning">{money(row.unallocatedTotal)} undated</small> : null}</td><td>{money(row.excludedMethodTotal)}</td><td><span className={`status-pill status-${row.status}`}>{row.statusLabel}</span>{row.issues.length ? <small>{row.issues.join(' · ')}</small> : null}</td></tr>
        ))}</tbody></table></div>
      ) : <div className="empty-state compact"><h3>No vendor payments for {year}</h3><p>{importedRows.length ? 'No matched spreadsheet vendors have payments for this tax year.' : 'Add dated project commitment payments or upload the QuickBooks 1099 Excel report.'}</p></div>}
    </div>
  );
}
