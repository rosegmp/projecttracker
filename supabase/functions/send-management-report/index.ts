import { createClient } from 'npm:@supabase/supabase-js@2';
import { getRequestId, jsonResponse, logEdgeFailure, REQUEST_ID_HEADER } from '../_shared/requestCorrelation.ts';
import { getAppRuntimeStatus, maintenanceMessage } from '../_shared/maintenance.ts';

const FUNCTION_NAME = 'send-management-report';
function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`${name} is not configured.`); return value; }
function serviceKey() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY'); }
function safeEqual(left: string, right: string) { if (!left || left.length !== right.length) return false; let difference = 0; for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i); return difference === 0; }
function cleanEmail(value: unknown) { const result = String(value || '').trim().toLowerCase(); return /^\S+@\S+\.\S+$/.test(result) ? result : ''; }
function escapeHtml(value: unknown) { return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); }

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': `content-type, x-management-report-token, ${REQUEST_ID_HEADER}`, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const respond = (body: Record<string, unknown>, status = 200) => jsonResponse(body, status, requestId, headers);
  const fail = (error: string, status: number, operation: string, code: unknown) => { logEdgeFailure({ code, functionName: FUNCTION_NAME, operation, requestId, status }); return respond({ error }, status); };
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return fail('Method not allowed.', 405, 'request.validate', 'method_not_allowed');
  try {
    if (!safeEqual(request.headers.get('x-management-report-token') || '', env('MANAGEMENT_REPORT_SCHEDULE_TOKEN'))) return fail('Scheduled report authorization failed.', 401, 'schedule.authenticate', 'invalid_schedule_token');
    const admin = createClient(env('SUPABASE_URL'), serviceKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    const runtime = await getAppRuntimeStatus(admin); if (runtime.writesFrozen) return fail(maintenanceMessage(runtime), 503, 'maintenance.check', 'app_writes_frozen');
    const [{ data: settingsRow, error: settingsError }, { data: users, error: usersError }] = await Promise.all([admin.from('settings').select('data').eq('id', 'app_settings').maybeSingle(), admin.from('app_users').select('data')]);
    if (settingsError || usersError) return fail('Unable to read scheduled report settings.', 500, 'settings.read', settingsError?.code || usersError?.code);
    const settings = settingsRow?.data || {};
    if (settings.managementReportsScheduledEnabled !== true) return respond({ ok: true, status: 'disabled', sent: 0, skipped: 0, failed: 0 });
    const schedule = settings.managementReportsSchedule === 'monthly' ? 'monthly' : 'weekly';
    const now = new Date(), today = now.toISOString().slice(0, 10), due = schedule === 'monthly' ? now.getUTCDate() === 1 : now.getUTCDay() === 1;
    if (!due) return respond({ ok: true, status: 'not_due', schedule, sent: 0, skipped: 0, failed: 0 });
    const recipients = [...new Set((users || []).filter((user) => user.data?.role === 'Admin').map((user) => cleanEmail(user.data?.email)).filter(Boolean))];
    if (!recipients.length) return respond({ ok: true, status: 'no_recipients', schedule, sent: 0, skipped: 0, failed: 0 });
    const { data: snapshot, error: captureError } = await admin.rpc('capture_management_reporting_snapshot', { p_snapshot_date: today });
    if (captureError || !snapshot?.id) return fail('Unable to capture today’s management report.', 500, 'snapshot.capture', captureError?.code || 'snapshot_missing');
    const [{ data: snapshotRow, error: snapshotError }, { data: subcontractors, error: subcontractorsError }] = await Promise.all([admin.from('management_reporting_snapshots').select('*').eq('id', snapshot.id).single(), admin.from('management_reporting_subcontractor_snapshots').select('*').eq('snapshot_id', snapshot.id)]);
    if (snapshotError || !snapshotRow || subcontractorsError) return fail('Unable to load today’s management report.', 500, 'snapshot.read', snapshotError?.code || subcontractorsError?.code || 'snapshot_missing');
    const compliancePercent = snapshotRow.active_subcontractors ? Math.round(snapshotRow.compliant_subcontractors / snapshotRow.active_subcontractors * 100) : 0;
    const attention = (subcontractors || [])
      .filter((row) => !row.compliant || row.past_due_commitments || row.warranty_overdue)
      .sort((left, right) => Number(right.warranty_overdue || 0) - Number(left.warranty_overdue || 0)
        || Number(right.past_due_commitments || 0) - Number(left.past_due_commitments || 0)
        || Number(left.compliant) - Number(right.compliant)
        || String(left.subcontractor_name || '').localeCompare(String(right.subcontractor_name || '')))
      .slice(0, 10);
    const lines = attention.map((row) => `- ${row.subcontractor_name}: ${row.compliant ? 'compliant' : 'compliance needed'}; ${row.past_due_commitments} past-due commitments; ${row.warranty_overdue} overdue warranty items`).join('\n');
    const htmlLines = attention.map((row) => `<li><strong>${escapeHtml(row.subcontractor_name)}</strong>: ${row.compliant ? 'compliant' : 'compliance needed'}; ${row.past_due_commitments} past-due commitments; ${row.warranty_overdue} overdue warranty items</li>`).join('');
    let sent = 0, skipped = 0, failed = 0;
    for (const recipient of recipients) {
      const { data: delivery, error: claimError } = await admin.rpc('claim_management_report_delivery', { p_snapshot_date: today, p_schedule: schedule, p_recipient_email: recipient });
      if (claimError) return fail('Unable to checkpoint management report delivery.', 500, 'delivery.claim', claimError.code);
      if (!delivery?.id) { skipped += 1; continue; }
      const subject = `${schedule === 'monthly' ? 'Monthly' : 'Weekly'} Project Hub management report - ${today}`;
      const text = `Project Hub management report\n\nCompliance: ${compliancePercent}% (${snapshotRow.compliant_subcontractors}/${snapshotRow.active_subcontractors})\nMissing General Liability: ${snapshotRow.missing_general_liability}\nMissing agreements: ${snapshotRow.missing_agreement}\nMissing W-9s: ${snapshotRow.missing_w9}\n\nSubcontractors needing attention:\n${lines || '- None'}\n\nOpen the complete portfolio report: https://projecthub.destinyhomesnj.com/?tab=reports`;
      const htmlBody = `<h2>Project Hub management report</h2><p><strong>Compliance: ${compliancePercent}%</strong> (${snapshotRow.compliant_subcontractors}/${snapshotRow.active_subcontractors})</p><ul><li>Missing General Liability: ${snapshotRow.missing_general_liability}</li><li>Missing agreements: ${snapshotRow.missing_agreement}</li><li>Missing W-9s: ${snapshotRow.missing_w9}</li></ul><h3>Subcontractors needing attention</h3>${htmlLines ? `<ul>${htmlLines}</ul>` : '<p>None.</p>'}<p><a href="https://projecthub.destinyhomesnj.com/?tab=reports">Open the complete portfolio report</a></p>`;
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `management-report:${delivery.id}` }, body: JSON.stringify({ from: Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || env('MANAGEMENT_REPORT_EMAIL_FROM'), to: [recipient], subject, text, html: htmlBody }) });
      const deliveryStatus = response.ok ? 'sent' : 'failed';
      const { error: checkpointError } = await admin.from('management_report_deliveries').update({ delivery_status: deliveryStatus, delivered_at: response.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', delivery.id);
      if (checkpointError) {
        logEdgeFailure({ code: checkpointError.code, functionName: FUNCTION_NAME, operation: 'delivery.checkpoint', requestId, status: 500 });
        failed += 1;
      } else if (response.ok) sent += 1;
      else failed += 1;
    }
    return respond({ ok: failed === 0, status: failed ? 'partial' : 'complete', schedule, sent, skipped, failed, attention: attention.length, compliancePercent });
  } catch (error) { return fail('Unable to send the scheduled management report.', 500, 'request.execute', error instanceof Error ? error.name : 'unexpected_error'); }
});
