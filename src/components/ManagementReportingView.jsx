import React, { useEffect, useMemo, useState } from 'react';
import { getVisibleProjectsForUser } from '../utils/accessUi.js';
import { loadPortalItemsForProjects, loadWorkflowItemsForProjects } from '../services/constructionWorkflows.js';
import { deliverBlob } from '../platform/platformAdapter.js';
import { buildManagementReport, managementReportCsv, summarizeManagementReport } from '../utils/managementReporting.js';
import { captureManagementReportingSnapshot, loadManagementReportingSnapshots, loadManagementSubcontractorSnapshots } from '../services/managementReporting.js';
import SavedFiltersControls from './SavedFiltersControls.jsx';
import FluentIcon from './FluentIcon.jsx';

function money(value) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0); }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function ManagementReportingView({ data, activeUser }) {
  const [workflows, setWorkflows] = useState({ changeOrders: [], budgetItems: [], commitments: [], portalItems: [], closeoutItems: [] });
  const [filters, setFilters] = useState({ status: 'active', attention: 'all', search: '' });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState('');
  const [subcontractorMeasures, setSubcontractorMeasures] = useState([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const projects = useMemo(() => getVisibleProjectsForUser(data.projects || [], data.settings, activeUser), [activeUser, data.projects, data.settings]);
  const todayIso = new Date().toLocaleDateString('en-CA');

  async function refresh() {
    setLoading(true); setMessage('');
    try {
      const ids = projects.map((project) => project.id);
      const [changeOrders, budgetItems, commitments, portalItems, closeoutItems] = await Promise.all([
        loadWorkflowItemsForProjects('changeOrders', ids), loadWorkflowItemsForProjects('budgetItems', ids), loadWorkflowItemsForProjects('commitments', ids), loadPortalItemsForProjects(ids), loadWorkflowItemsForProjects('closeoutItems', ids),
      ]);
      setWorkflows({ changeOrders, budgetItems, commitments, portalItems, closeoutItems });
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load management reporting data.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, [projects.map((project) => project.id).join('|')]);
  async function refreshHistory(preferredId = '') {
    try {
      const next = await loadManagementReportingSnapshots();
      setSnapshots(next);
      const nextId = preferredId || selectedSnapshotId || next[0]?.id || '';
      setSelectedSnapshotId(nextId);
      setSubcontractorMeasures(nextId ? await loadManagementSubcontractorSnapshots(nextId) : []);
      setHistoryMessage('');
    } catch (error) {
      setSnapshots([]); setSubcontractorMeasures([]);
      setHistoryMessage(/management_reporting|PGRST205|404|schema cache/i.test(String(error)) ? 'Historical reporting will be available after the included reporting migration is applied.' : error instanceof Error ? error.message : 'Unable to load reporting history.');
    }
  }
  useEffect(() => { void refreshHistory(); }, []);

  async function chooseSnapshot(snapshotId) {
    setSelectedSnapshotId(snapshotId);
    try { setSubcontractorMeasures(await loadManagementSubcontractorSnapshots(snapshotId)); setHistoryMessage(''); }
    catch (error) { setHistoryMessage(error instanceof Error ? error.message : 'Unable to load subcontractor measures.'); }
  }

  async function captureSnapshot() {
    setSnapshotBusy(true); setHistoryMessage('');
    try { const captured = await captureManagementReportingSnapshot(todayIso); await refreshHistory(captured?.id || ''); setHistoryMessage(`Captured the ${todayIso} reporting snapshot.`); }
    catch (error) { setHistoryMessage(error instanceof Error ? error.message : 'Unable to capture today’s reporting snapshot.'); }
    finally { setSnapshotBusy(false); }
  }
  const allRows = useMemo(() => buildManagementReport(projects, workflows, todayIso), [projects, todayIso, workflows]);
  const rows = useMemo(() => allRows.filter((row) => {
    if (filters.status === 'active' && ['complete', 'completed', 'cancelled', 'inactive'].includes(String(row.status).toLowerCase())) return false;
    if (filters.status !== 'active' && filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.attention === 'attention' && !row.attentionCount) return false;
    if (filters.attention === 'delayed' && !row.scheduleVarianceDays) return false;
    if (filters.attention === 'budget' && !row.budgetExposure) return false;
    const query = filters.search.trim().toLowerCase();
    return !query || `${row.projectName} ${row.customerName}`.toLowerCase().includes(query);
  }), [allRows, filters]);
  const summary = useMemo(() => summarizeManagementReport(rows), [rows]);
  const statuses = [...new Set(allRows.map((row) => row.status))].sort();

  async function exportCsv() {
    const blob = new Blob([managementReportCsv(rows)], { type: 'text/csv;charset=utf-8' });
    await deliverBlob(blob, `management-report-${todayIso}.csv`);
  }

  return <section className="panel native-panel workspace-page management-reporting">
    <header className="management-report-header"><div><p className="eyebrow">Portfolio intelligence</p><h1>Management reporting</h1><p>Current schedule, financial, approval, and closeout exposure across authorized projects.</p></div><div className="management-report-actions"><button className="button secondary" type="button" disabled={loading} onClick={() => void refresh()}><FluentIcon name="replace" size={16} />Refresh</button><button className="button secondary" type="button" disabled={!rows.length} onClick={() => void exportCsv()}>Export CSV</button><button className="button primary" type="button" disabled={!rows.length} onClick={() => window.print()}>Print / Save PDF</button></div></header>
    <div className="management-report-filters"><label><span>Project status</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="active">Active projects</option><option value="all">All projects</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><label><span>Focus</span><select value={filters.attention} onChange={(event) => setFilters((current) => ({ ...current, attention: event.target.value }))}><option value="all">All</option><option value="attention">Needs attention</option><option value="delayed">Schedule delayed</option><option value="budget">Budget exposure</option></select></label><label className="management-report-search"><span>Search</span><input type="search" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Project or customer" /></label><SavedFiltersControls storageKey={`management-report-filters:${activeUser?.id || activeUser?.email || 'admin'}`} currentValue={filters} onApply={setFilters} /></div>
    {message ? <div className="audit-trail-message error" role="alert">{message}</div> : null}
    <div className="management-report-summary"><div><span>Projects</span><strong>{summary.projects}</strong></div><div className={summary.delayedProjects ? 'is-warning' : ''}><span>Schedule delayed</span><strong>{summary.delayedProjects}</strong></div><div><span>Portfolio budget</span><strong>{money(summary.budget)}</strong><small>{money(summary.forecast)} forecast</small></div><div className={summary.budgetExposure ? 'is-warning' : ''}><span>Budget exposure</span><strong>{money(summary.budgetExposure)}</strong></div><div className={summary.outstandingApprovals ? 'is-warning' : ''}><span>Outstanding approvals</span><strong>{summary.outstandingApprovals}</strong></div><div><span>Closeout progress</span><strong>{Math.round(summary.closeoutPercent)}%</strong></div></div>
    {loading ? <div className="empty-state compact"><p>Loading management report…</p></div> : rows.length ? <div className="management-report-table-wrap"><table className="management-report-table"><thead><tr><th>Project</th><th>Schedule variance</th><th>Budget / forecast</th><th>Exposure</th><th>Approvals</th><th>Closeout</th></tr></thead><tbody>{rows.map((row) => <tr key={row.projectId}><td><strong>{row.projectName}</strong><small>{label(row.status)}{row.customerName ? ` · ${row.customerName}` : ''}</small></td><td className={row.scheduleVarianceDays ? 'is-warning' : ''}><strong>{row.scheduleVarianceDays ? `${row.scheduleVarianceDays} days` : 'On track'}</strong><small>{row.overdueSteps} overdue step{row.overdueSteps === 1 ? '' : 's'}</small></td><td><strong>{money(row.currentBudget)}</strong><small>{money(row.forecast)} forecast · {money(row.committed)} committed</small></td><td className={row.budgetExposure ? 'is-warning' : ''}><strong>{money(row.budgetExposure)}</strong></td><td className={row.outstandingApprovals ? 'is-warning' : ''}><strong>{row.outstandingApprovals}</strong></td><td><strong>{row.closeoutPercent == null ? 'Not started' : `${row.closeoutPercent}%`}</strong><small>{row.closeoutComplete} of {row.closeoutRequired} required</small></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><h3>No matching projects</h3><p>Adjust the report filters to include more projects.</p></div>}
    <div className="vendor-1099-guidance"><FluentIcon name="warning" size={18} /><span>Schedule variance is the maximum calendar days past an unfinished step end date. Budget exposure is the greater of forecast or commitments above current budget. Historical compliance trends and scored subcontractor performance require reporting snapshots and are not inferred from current records.</span></div>
    <section className="management-history-section"><div className="management-history-heading"><div><p className="eyebrow">Measured over time</p><h2>Compliance trend</h2><p>Daily snapshots preserve the state that existed on each reporting date.</p></div><button className="button secondary" type="button" disabled={snapshotBusy} onClick={() => void captureSnapshot()}>{snapshotBusy ? 'Capturing…' : 'Capture today’s snapshot'}</button></div>
      {historyMessage ? <div className={`audit-trail-message${historyMessage.startsWith('Captured') ? ' success' : ''}`} role="status">{historyMessage}</div> : null}
      {snapshots.length ? <div className="management-compliance-trend">{[...snapshots].reverse().map((snapshot) => { const percent = snapshot.activeSubcontractors ? Math.round(snapshot.compliantSubcontractors / snapshot.activeSubcontractors * 100) : 0; return <div key={snapshot.id} className="management-trend-column"><div className="management-trend-bar"><span style={{ height: `${percent}%` }} /></div><strong>{percent}%</strong><small>{snapshot.snapshotDate}</small><small>{snapshot.compliantSubcontractors}/{snapshot.activeSubcontractors}</small></div>; })}</div> : !historyMessage ? <div className="empty-state compact"><p>Capture the first snapshot to begin compliance trending.</p></div> : null}
    </section>
    {snapshots.length ? <section className="management-history-section"><div className="management-history-heading"><div><p className="eyebrow">Transparent measures</p><h2>Subcontractor performance</h2><p>Workload and outcome counts are shown separately; Project Hub does not assign an opaque composite score.</p></div><label><span>Snapshot</span><select value={selectedSnapshotId} onChange={(event) => void chooseSnapshot(event.target.value)}>{snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{snapshot.snapshotDate}</option>)}</select></label></div>
      <div className="management-report-table-wrap"><table className="management-report-table subcontractor-measures-table"><thead><tr><th>Subcontractor</th><th>Compliance</th><th>Commitments</th><th>Past due</th><th>Warranty assigned</th><th>Warranty completed</th><th>Warranty overdue</th></tr></thead><tbody>{subcontractorMeasures.map((row) => <tr key={row.subcontractorId}><td><strong>{row.subcontractorName}</strong></td><td className={row.compliant ? '' : 'is-warning'}><strong>{row.compliant ? 'Compliant' : 'Needs attention'}</strong></td><td><strong>{row.commitmentCount}</strong><small>{money(row.committedAmount)}</small></td><td className={row.pastDueCommitments ? 'is-warning' : ''}><strong>{row.pastDueCommitments}</strong></td><td><strong>{row.warrantyAssigned}</strong></td><td><strong>{row.warrantyCompleted}</strong></td><td className={row.warrantyOverdue ? 'is-warning' : ''}><strong>{row.warrantyOverdue}</strong></td></tr>)}</tbody></table></div>
    </section> : null}
  </section>;
}
