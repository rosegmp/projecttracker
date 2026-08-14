import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  getRequestId,
  jsonResponse,
  logEdgeFailure,
  REQUEST_ID_HEADER,
} from '../_shared/requestCorrelation.ts';
import { getAppRuntimeStatus, maintenanceMessage } from '../_shared/maintenance.ts';
import {
  buildScheduledComplianceReminderCandidates,
  buildScheduledComplianceFollowupCandidates,
} from '../_shared/complianceReminders.js';

const FUNCTION_NAME = 'send-compliance-reminders';

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || requiredEnv('SUPABASE_SECRET_KEY');
}

function safeTokenEquals(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cleanEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEmailDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

const complianceAttachmentCache = new Map<string, Promise<{ filename: string; content: string }>>();

function loadComplianceAttachment(key: 'w9' | 'agreement' | 'sample_coi') {
  const attachment = {
    w9: { filename: 'Form W-9.pdf', path: './attachments/form-w9.pdf' },
    agreement: { filename: 'Destiny Homes Subcontractor Agreement.pdf', path: './attachments/destiny-homes-subcontractor-agreement.pdf' },
    sample_coi: { filename: 'Sample Certificate of Insurance.pdf', path: './attachments/sample-certificate-of-insurance.pdf' },
  }[key];
  if (!complianceAttachmentCache.has(key)) {
    complianceAttachmentCache.set(key, Deno.readFile(new URL(attachment.path, import.meta.url))
      .then((bytes) => ({ filename: attachment.filename, content: encodeBase64(bytes) })));
  }
  return complianceAttachmentCache.get(key)!;
}

type ReminderCandidate = {
  subcontractorId: string;
  subcontractorName: string;
  recipientEmail: string;
  certificateId: string;
  coverageId: string;
  expirationDate: string;
  reminderDays: number;
};

type FollowupCandidate = {
  subcontractorId: string;
  subcontractorName: string;
  recipientEmail: string;
  requestedAt: string;
  requestedDate: string;
  reminderDays: number;
  missing: string[];
  latestExpirationDate: string;
};

async function sendReminder(candidate: ReminderCandidate, deliveryId: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('CERTIFICATE_RENEWAL_EMAIL_FROM') || Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || '';
  if (!apiKey || !from) return { sent: false, status: 'unconfigured' };

  const replyTo = cleanEmail(Deno.env.get('COMPLIANCE_EMAIL_REPLY_TO') || 'rose@destinyhomesnj.com');
  const destination = replyTo || 'rose@destinyhomesnj.com';
  const expiration = formatEmailDate(candidate.expirationDate);
  const urgency = candidate.reminderDays <= 14 ? 'Action required: ' : '';
  const subject = `${urgency}Insurance certificate expires in ${candidate.reminderDays} days - ${candidate.subcontractorName}`.slice(0, 240);
  const requirement = 'Please ask your insurance agent to issue an updated certificate showing current General Liability coverage. For General Liability only, the certificate must name Destiny Homes LLC, 102 Destiny Way, Lakewood, NJ 08701 as an additional insured. Please include Workers Compensation coverage when it applies to your business; additional-insured status is not required for Workers Compensation.';
  const text = `Hello ${candidate.subcontractorName},\n\nThis is an automatic reminder that your current insurance certificate expires on ${expiration}, in ${candidate.reminderDays} days.\n\n${requirement}\n\nA redacted sample certificate showing the requested format is attached. Please reply to this email with the renewed certificate, or send it to ${destination}.\n\nSincerely,\n\nRoisie Engelman\nDestiny Homes LLC`;
  const html = `<p>Hello ${escapeHtml(candidate.subcontractorName)},</p><p>This is an automatic reminder that your current insurance certificate expires on <strong>${escapeHtml(expiration)}</strong>, in ${candidate.reminderDays} days.</p><p>${escapeHtml(requirement)}</p><p>A redacted sample certificate showing the requested format is attached. Please reply to this email with the renewed certificate, or send it to ${escapeHtml(destination)}.</p><p>Sincerely,</p><p>Roisie Engelman<br>Destiny Homes LLC</p>`;
  const attachment = await loadComplianceAttachment('sample_coi');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `scheduled-compliance:${deliveryId}`,
    },
    body: JSON.stringify({
      from,
      to: [candidate.recipientEmail],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
      html,
      attachments: [attachment],
    }),
  });
  return { sent: response.ok, status: response.ok ? 'sent' : 'failed' };
}

async function sendFollowup(candidate: FollowupCandidate, deliveryId: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('CERTIFICATE_RENEWAL_EMAIL_FROM') || Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || '';
  if (!apiKey || !from) return { sent: false, status: 'unconfigured' };

  const missingLabels: Record<string, string> = {
    general_liability: 'Current General Liability insurance certificate',
    subcontractor_agreement: 'Signed Destiny Homes subcontractor agreement',
    w9: 'Completed Form W-9',
  };
  const attachmentKeys = new Set<'w9' | 'agreement' | 'sample_coi'>();
  if (candidate.missing.includes('w9')) attachmentKeys.add('w9');
  if (candidate.missing.includes('subcontractor_agreement')) attachmentKeys.add('agreement');
  if (candidate.missing.includes('general_liability')) attachmentKeys.add('sample_coi');
  const attachments = await Promise.all([...attachmentKeys].map(loadComplianceAttachment));
  const replyTo = cleanEmail(Deno.env.get('COMPLIANCE_EMAIL_REPLY_TO') || 'rose@destinyhomesnj.com');
  const destination = replyTo || 'rose@destinyhomesnj.com';
  const textList = candidate.missing.map((requirement) => `- ${missingLabels[requirement]}`).join('\n');
  const htmlList = candidate.missing.map((requirement) => `<li>${escapeHtml(missingLabels[requirement])}</li>`).join('');
  const subject = `${candidate.reminderDays}-day follow-up: compliance documents needed - ${candidate.subcontractorName}`.slice(0, 240);
  const insuranceRequirements = 'Insurance certificates must show current General Liability coverage. For General Liability only, the certificate must name Destiny Homes LLC, 102 Destiny Way, Lakewood, NJ 08701 as an additional insured. Please include Workers Compensation coverage when it applies to your business; additional-insured status is not required for Workers Compensation.';
  const text = `Hello ${candidate.subcontractorName},\n\nThis is a follow-up to our compliance request sent on ${formatEmailDate(candidate.requestedDate)}. We still need:\n${textList}\n\n${insuranceRequirements}\n\nPlease reply to this email with the requested documents, or send them to ${destination}. Applicable blank forms and the sample certificate are attached.\n\nSincerely,\n\nRoisie Engelman\nDestiny Homes LLC`;
  const html = `<p>Hello ${escapeHtml(candidate.subcontractorName)},</p><p>This is a follow-up to our compliance request sent on ${escapeHtml(formatEmailDate(candidate.requestedDate))}. We still need:</p><ul>${htmlList}</ul><p>${escapeHtml(insuranceRequirements)}</p><p>Please reply to this email with the requested documents, or send them to ${escapeHtml(destination)}. Applicable blank forms and the sample certificate are attached.</p><p>Sincerely,</p><p>Roisie Engelman<br>Destiny Homes LLC</p>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `scheduled-compliance-followup:${deliveryId}`,
    },
    body: JSON.stringify({
      from,
      to: [candidate.recipientEmail],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
      html,
      attachments,
    }),
  });
  return { sent: response.ok, status: response.ok ? 'sent' : 'failed' };
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': `content-type, x-compliance-reminder-token, ${REQUEST_ID_HEADER}`,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
  };
  const respond = (body: Record<string, unknown>, status = 200) => jsonResponse(body, status, requestId, headers);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: FUNCTION_NAME, operation, requestId, status });
    return respond({ error }, status);
  };
  let operation = 'request.initialize';

  if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...headers, [REQUEST_ID_HEADER]: requestId } });
  if (request.method !== 'POST') return fail('Method not allowed.', 405, operation, 'method_not_allowed');

  try {
    operation = 'schedule.authenticate';
    const expectedToken = requiredEnv('COMPLIANCE_REMINDER_SCHEDULE_TOKEN');
    if (!safeTokenEquals(request.headers.get('x-compliance-reminder-token') || '', expectedToken)) {
      return fail('Scheduled reminder authorization failed.', 401, operation, 'invalid_schedule_token');
    }

    const admin = createClient(requiredEnv('SUPABASE_URL'), serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    operation = 'maintenance.check';
    const runtimeStatus = await getAppRuntimeStatus(admin);
    if (runtimeStatus.writesFrozen) return fail(maintenanceMessage(runtimeStatus), 503, operation, 'app_writes_frozen');

    operation = 'settings.read';
    const { data: settingsRow, error: settingsError } = await admin.from('settings').select('data').eq('id', 'app_settings').maybeSingle();
    if (settingsError) throw settingsError;
    if (settingsRow?.data?.complianceScheduledRemindersEnabled !== true) {
      return respond({ ok: true, status: 'disabled', candidates: 0, sent: 0, skipped: 0, failed: 0 });
    }
    if (settingsRow?.data?.complianceEmailTestMode === true) {
      return respond({ ok: true, status: 'paused_for_test_mode', candidates: 0, sent: 0, skipped: 0, failed: 0 });
    }

    operation = 'compliance.read';
    const [subcontractorsResult, certificatesResult, coveragesResult, documentsResult] = await Promise.all([
      admin.from('subs').select('id,data'),
      admin.from('insurance_certificates').select('id,subcontractor_id,effective_date,expiration_date'),
      admin.from('insurance_certificate_coverages').select('id,certificate_id,coverage_type,effective_date,expiration_date'),
      admin.from('subcontractor_compliance_documents').select('subcontractor_id,document_type,source_path'),
    ]);
    if (subcontractorsResult.error) throw subcontractorsResult.error;
    if (certificatesResult.error) throw certificatesResult.error;
    if (coveragesResult.error) throw coveragesResult.error;
    if (documentsResult.error) throw documentsResult.error;

    const today = new Date().toISOString().slice(0, 10);
    const candidates = buildScheduledComplianceReminderCandidates({
      today,
      subcontractors: subcontractorsResult.data || [],
      certificates: certificatesResult.data || [],
      coverages: coveragesResult.data || [],
    }) as ReminderCandidate[];
    const followupCandidates = buildScheduledComplianceFollowupCandidates({
      today,
      subcontractors: subcontractorsResult.data || [],
      certificates: certificatesResult.data || [],
      coverages: coveragesResult.data || [],
      documents: documentsResult.data || [],
    }) as FollowupCandidate[];

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      operation = 'reminder.claim';
      const { data: claimed, error: claimError } = await admin.rpc('claim_scheduled_compliance_reminder', {
        p_subcontractor_id: candidate.subcontractorId,
        p_source_certificate_id: candidate.certificateId,
        p_source_coverage_id: candidate.coverageId,
        p_expiration_date: candidate.expirationDate,
        p_reminder_days: candidate.reminderDays,
        p_scheduled_for: today,
        p_recipient_email: candidate.recipientEmail,
      });
      if (claimError) throw claimError;
      if (!claimed?.id) {
        skipped += 1;
        continue;
      }

      operation = 'reminder.deliver';
      const delivery = await sendReminder(candidate, String(claimed.id));
      const { error: updateError } = await admin
        .from('compliance_scheduled_reminder_deliveries')
        .update({
          delivery_status: delivery.status,
          delivered_at: delivery.sent ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', claimed.id);
      if (updateError) throw updateError;
      if (delivery.sent) sent += 1;
      else failed += 1;
    }

    for (const candidate of followupCandidates) {
      operation = 'followup.claim';
      const { data: claimed, error: claimError } = await admin.rpc('claim_scheduled_compliance_followup', {
        p_subcontractor_id: candidate.subcontractorId,
        p_requested_at: candidate.requestedAt,
        p_reminder_days: candidate.reminderDays,
        p_scheduled_for: today,
        p_missing_requirements: candidate.missing,
        p_recipient_email: candidate.recipientEmail,
      });
      if (claimError) throw claimError;
      if (!claimed?.id) {
        skipped += 1;
        continue;
      }

      operation = 'followup.deliver';
      const delivery = await sendFollowup(candidate, String(claimed.id));
      const { error: updateError } = await admin
        .from('compliance_scheduled_followup_deliveries')
        .update({
          delivery_status: delivery.status,
          delivered_at: delivery.sent ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', claimed.id);
      if (updateError) throw updateError;
      if (delivery.sent) sent += 1;
      else failed += 1;
    }

    return respond({
      ok: true,
      status: failed ? 'partial' : 'complete',
      candidates: candidates.length + followupCandidates.length,
      expirationCandidates: candidates.length,
      followupCandidates: followupCandidates.length,
      sent,
      skipped,
      failed,
      limited: false,
    });
  } catch (error) {
    return fail('Unable to process scheduled compliance reminders.', 500, operation, error instanceof Error ? error.name : 'unknown_error');
  }
});
