import { fetchAuthorizedSupabase } from './trackerData.js';

async function json(response, fallback) {
  const text = await response.text();
  if (!response.ok) throw new Error(text || fallback);
  return text ? JSON.parse(text) : null;
}

export async function loadManagementReportingSnapshots(limit = 12) {
  const bounded = Math.max(1, Math.min(36, Number(limit) || 12));
  const response = await fetchAuthorizedSupabase(`/rest/v1/management_reporting_snapshots?select=*&order=snapshot_date.desc&limit=${bounded}`, { method: 'GET' }, 'Management reporting snapshots');
  const rows = await json(response, 'Unable to load management reporting history.');
  return (rows || []).map((row) => ({ id: row.id, snapshotDate: row.snapshot_date, activeSubcontractors: row.active_subcontractors, compliantSubcontractors: row.compliant_subcontractors, missingGeneralLiability: row.missing_general_liability, missingAgreement: row.missing_agreement, missingW9: row.missing_w9, capturedAt: row.captured_at }));
}

export async function loadManagementSubcontractorSnapshots(snapshotId) {
  if (!snapshotId) return [];
  const response = await fetchAuthorizedSupabase(`/rest/v1/management_reporting_subcontractor_snapshots?snapshot_id=eq.${encodeURIComponent(snapshotId)}&select=*&order=subcontractor_name.asc`, { method: 'GET' }, 'Subcontractor reporting snapshot');
  const rows = await json(response, 'Unable to load subcontractor reporting measures.');
  return (rows || []).map((row) => ({ subcontractorId: row.subcontractor_id, subcontractorName: row.subcontractor_name, compliant: row.compliant, commitmentCount: row.commitment_count, committedAmount: Number(row.committed_amount || 0), pastDueCommitments: row.past_due_commitments, warrantyAssigned: row.warranty_assigned, warrantyCompleted: row.warranty_completed, warrantyOverdue: row.warranty_overdue }));
}

export async function captureManagementReportingSnapshot(snapshotDate) {
  const response = await fetchAuthorizedSupabase('/rest/v1/rpc/capture_management_reporting_snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_snapshot_date: snapshotDate }) }, 'Capture management reporting snapshot');
  return json(response, 'Unable to capture the management reporting snapshot.');
}
