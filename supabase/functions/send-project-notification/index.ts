import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  getRequestId,
  jsonResponse,
  logEdgeFailure,
  REQUEST_ID_HEADER,
} from '../_shared/requestCorrelation.ts';
import { getAppRuntimeStatus, maintenanceMessage } from '../_shared/maintenance.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': `authorization, x-client-info, apikey, content-type, ${REQUEST_ID_HEADER}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
};
const allowedKinds = new Set(['task-created', 'task-updated', 'task-assigned', 'inspection-updated', 'comment-mentioned', 'selection-approval-requested', 'certificate-renewal-requested', 'subcontractor-compliance-requested']);
let cachedGoogleToken: { value: string; expiresAt: number } | null = null;
const complianceAttachmentCache = new Map<string, Promise<{ filename: string; content: string }>>();

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || requiredEnv('SUPABASE_SECRET_KEY');
}

function bearerToken(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemToBytes(pem: string) {
  const binary = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function googleAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || 'Firebase authentication failed.');
  cachedGoogleToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return cachedGoogleToken.value;
}

function normalizeRole(value: unknown) {
  return String(value || '').trim();
}

function cleanEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function personAssignmentKeys(data: Record<string, unknown> = {}) {
  const first = String(data.first || '').trim();
  const last = String(data.last || '').trim();
  const name = `${first} ${last}`.trim();
  const company = String(data.company || '').trim();
  const label = name && company ? `${name} (${company})` : name || company;
  return [label, name, cleanEmail(data.email)]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function resolveTaskEmailRecipients({
  assignees,
  settingsData,
  appUsers,
  people,
}: {
  assignees: string[];
  settingsData: Record<string, unknown>;
  appUsers: Array<{ data?: Record<string, unknown> }>;
  people: Array<{ data?: Record<string, unknown>; people_type?: string }>;
}) {
  const requested = new Set(assignees.map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!requested.size) return [];
  const includeInternal = settingsData.emailNewTasksToInternalAssignees === true;
  const includeExternal = settingsData.emailNewTasksToExternalAssignees === true;
  const recipients = new Map<string, { email: string; name: string }>();
  const add = (data: Record<string, unknown> = {}, keys: string[] = []) => {
    if (!keys.some((key) => requested.has(key))) return;
    const email = cleanEmail(data.email);
    if (!email) return;
    const name = String(data.name || `${data.first || ''} ${data.last || ''}`).trim()
      || String(data.company || '').trim()
      || 'Task assignee';
    recipients.set(email, { email, name });
  };

  if (includeInternal) {
    appUsers
      .filter((user) => ['Admin', 'Edit', 'View Only'].includes(normalizeRole(user.data?.role)))
      .forEach((user) => {
        const data = user.data || {};
        add(data, [String(data.name || '').trim().toLowerCase(), cleanEmail(data.email)].filter(Boolean));
      });
    people
      .filter((row) => String(row.people_type || row.data?.peopleType || '') === 'emp')
      .forEach((row) => add(row.data || {}, personAssignmentKeys(row.data || {})));
  }
  if (includeExternal) {
    people
      .filter((row) => ['sub', 'supplier'].includes(String(row.people_type || row.data?.peopleType || '')))
      .forEach((row) => add(row.data || {}, personAssignmentKeys(row.data || {})));
  }
  return [...recipients.values()].sort((left, right) => left.email.localeCompare(right.email));
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function loadComplianceAttachment(key: 'w9' | 'agreement' | 'sample_coi') {
  const attachment = {
    w9: { filename: 'Form W-9.pdf', path: './attachments/form-w9.pdf' },
    agreement: { filename: 'Destiny Homes Subcontractor Agreement.pdf', path: './attachments/destiny-homes-subcontractor-agreement.pdf' },
    sample_coi: { filename: 'Sample Certificate of Insurance.pdf', path: './attachments/sample-certificate-of-insurance.pdf' },
  }[key];
  if (!complianceAttachmentCache.has(key)) {
    complianceAttachmentCache.set(key, Deno.readFile(attachment.path).then((bytes) => ({
      filename: attachment.filename,
      content: bytesToBase64(bytes),
    })));
  }
  return complianceAttachmentCache.get(key)!;
}

function formatEmailDate(value: string) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : String(value || '');
}

function normalizedCoverageType(value: unknown) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('workerscomp') || normalized.includes('workmanscomp')) return 'workers_compensation';
  if (normalized.includes('generalliability') || normalized.includes('commercialgeneralliability')) return 'general_liability';
  return '';
}

function validEmailDate(value: unknown) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function is1099ReportingCompanyType(value: unknown) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return normalized === 'individual sole proprietor or single member llc'
    || normalized === 'limited liability company';
}

async function sendSubcontractorComplianceEmail({
  requestId,
  recipientEmail,
  deliveryEmail,
  subcontractorName,
  missing,
  latestExpirationDate,
  expiredCertificate,
  testMode,
}: {
  requestId: string;
  recipientEmail: string;
  deliveryEmail: string;
  subcontractorName: string;
  missing: string[];
  latestExpirationDate: string;
  expiredCertificate: boolean;
  testMode: boolean;
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('CERTIFICATE_RENEWAL_EMAIL_FROM') || Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || '';
  if (!apiKey || !from) return { sent: false, status: 'unconfigured', attachmentNames: [] as string[] };

  const missingLabels: Record<string, string> = {
    general_liability: 'Current General Liability insurance certificate',
    subcontractor_agreement: 'Signed Destiny Homes subcontractor agreement',
    w9: 'Completed Form W-9',
  };
  const list = missing.map((item) => `- ${missingLabels[item]}`).join('\n');
  const htmlList = missing.map((item) => `<li>${escapeHtml(missingLabels[item])}</li>`).join('');
  const attachmentKeys = new Set<'w9' | 'agreement' | 'sample_coi'>();
  if (missing.includes('w9')) attachmentKeys.add('w9');
  if (missing.includes('subcontractor_agreement')) attachmentKeys.add('agreement');
  if (missing.includes('general_liability')) attachmentKeys.add('sample_coi');
  const attachments = await Promise.all([...attachmentKeys].map(loadComplianceAttachment));
  const replyTo = cleanEmail(Deno.env.get('COMPLIANCE_EMAIL_REPLY_TO') || 'rose@destinyhomesnj.com');
  const destination = replyTo || 'rose@destinyhomesnj.com';
  const insuranceRequirements = 'The certificate must show current General Liability coverage and name Destiny Homes LLC, 102 Destiny Way, Lakewood, NJ 08701 as an additional insured. Please include Workers Compensation coverage when it applies to your business.';
  const expirationLine = latestExpirationDate
    ? `Our records show that your insurance certificate expired on ${formatEmailDate(latestExpirationDate)}.`
    : 'Our records do not show a current insurance certificate.';
  const subject = `${testMode ? '[TEST] ' : ''}${expiredCertificate ? 'Expired insurance certificate' : 'Subcontractor compliance documents needed'} - ${subcontractorName}`.slice(0, 240);
  const opening = expiredCertificate
    ? `${expirationLine}\n\nPlease ask your insurance agent to issue an updated certificate. ${insuranceRequirements}`
    : `To keep our vendor and subcontractor records current, please provide the following:\n${list}\n\nIRS regulations require Destiny Homes LLC to maintain Form W-9 information for vendors subject to 1099 reporting. Our insurance company also requires current insurance documentation and a signed subcontractor agreement. ${insuranceRequirements}`;
  const additional = expiredCertificate && missing.some((item) => ['w9', 'subcontractor_agreement'].includes(item))
    ? `\n\nWe also need the following documents:\n${missing.filter((item) => ['w9', 'subcontractor_agreement'].includes(item)).map((item) => `- ${missingLabels[item]}`).join('\n')}`
    : '';
  const testHeader = testMode ? `TEST MODE - Intended subcontractor email: ${recipientEmail}\n\n` : '';
  const text = `${testHeader}Hello ${subcontractorName},\n\n${opening}${additional}\n\nPlease reply to this email with the requested documents, or send them to ${destination}. Any applicable blank forms or sample certificate are attached.\n\nSincerely,\n\nRoisie Engelman\nDestiny Homes LLC`;
  const htmlOpening = expiredCertificate
    ? `<p>${escapeHtml(expirationLine)}</p><p>Please ask your insurance agent to issue an updated certificate. ${escapeHtml(insuranceRequirements)}</p>`
    : `<p>To keep our vendor and subcontractor records current, please provide the following:</p><ul>${htmlList}</ul><p>IRS regulations require Destiny Homes LLC to maintain Form W-9 information for vendors subject to 1099 reporting. Our insurance company also requires current insurance documentation and a signed subcontractor agreement. ${escapeHtml(insuranceRequirements)}</p>`;
  const htmlAdditional = expiredCertificate && missing.some((item) => ['w9', 'subcontractor_agreement'].includes(item))
    ? `<p>We also need the following documents:</p><ul>${missing.filter((item) => ['w9', 'subcontractor_agreement'].includes(item)).map((item) => `<li>${escapeHtml(missingLabels[item])}</li>`).join('')}</ul>`
    : '';
  const htmlTestHeader = testMode ? `<p><strong>TEST MODE - Intended subcontractor email: ${escapeHtml(recipientEmail)}</strong></p>` : '';
  const html = `${htmlTestHeader}<p>Hello ${escapeHtml(subcontractorName)},</p>${htmlOpening}${htmlAdditional}<p>Please reply to this email with the requested documents, or send them to ${escapeHtml(destination)}. Any applicable blank forms or sample certificate are attached.</p><p>Sincerely,</p><p>Roisie Engelman<br>Destiny Homes LLC</p>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `${requestId}:subcontractor-compliance`,
    },
    body: JSON.stringify({
      from,
      to: [deliveryEmail],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text,
      html,
      attachments,
    }),
  });
  return {
    sent: response.ok,
    status: response.ok ? 'sent' : 'failed',
    attachmentNames: attachments.map((attachment) => attachment.filename),
  };
}

function buildTaskDeepLink(projectId: string, taskId: string) {
  const url = new URL('https://projecthub.destinyhomesnj.com/');
  url.searchParams.set('tab', projectId ? 'projects' : 'tasks');
  if (projectId) {
    url.searchParams.set('project', projectId);
    url.searchParams.set('projectTab', 'tasks');
  }
  url.searchParams.set('task', taskId);
  return url.toString();
}

async function sendTaskAssignmentEmails({
  recipients,
  eventId,
  projectId,
  taskId,
  projectName,
  taskLabel,
  due,
}: {
  recipients: Array<{ email: string; name: string }>;
  eventId: string;
  projectId: string;
  taskId: string;
  projectName: string;
  taskLabel: string;
  due: string;
}) {
  if (!recipients.length) return { sent: 0, failed: 0, status: 'disabled' };
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || '';
  if (!apiKey || !from) return { sent: 0, failed: recipients.length, status: 'unconfigured' };
  const subject = `New task assignment · ${projectName}`.slice(0, 240);
  const dueLine = due ? `Due: ${due}` : 'Due date: Not set';
  const taskUrl = buildTaskDeepLink(projectId, taskId);
  const results = await Promise.all(recipients.map(async (recipient, index) => {
    const text = `Hello ${recipient.name},\n\nYou were assigned a new task in ${projectName}.\n\nTask: ${taskLabel}\n${dueLine}\n\nOpen task: ${taskUrl}`;
    const html = `<p>Hello ${escapeHtml(recipient.name)},</p><p>You were assigned a new task in <strong>${escapeHtml(projectName)}</strong>.</p><p><strong>Task:</strong> ${escapeHtml(taskLabel)}<br><strong>${escapeHtml(dueLine)}</strong></p><p><a href="${escapeHtml(taskUrl)}">Open task in Destiny Project Hub</a></p>`;
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${eventId}:task-assignment:${index}`,
      },
      body: JSON.stringify({ from, to: [recipient.email], subject, text, html }),
    });
    return response.ok;
  }));
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent, status: sent === results.length ? 'sent' : 'partial' };
}

async function sendCertificateRenewalEmail({
  requestId,
  recipientEmail,
  deliveryEmail,
  subcontractorName,
  expirationDate,
  requesterName,
  requesterEmail,
  testMode,
}: {
  requestId: string;
  recipientEmail: string;
  deliveryEmail: string;
  subcontractorName: string;
  expirationDate: string;
  requesterName: string;
  requesterEmail: string;
  testMode: boolean;
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('CERTIFICATE_RENEWAL_EMAIL_FROM') || Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || '';
  if (!apiKey || !from) return { sent: false, status: 'unconfigured' };
  const expired = Boolean(expirationDate && expirationDate < new Date().toISOString().slice(0, 10));
  const expirationLine = expirationDate
    ? expired
      ? `Our records show that your insurance certificate expired on ${formatEmailDate(expirationDate)}.`
      : `Your current insurance certificate expires on ${formatEmailDate(expirationDate)}.`
    : 'Our records do not show a current insurance certificate.';
  const contactName = requesterName || 'Roisie Engelman';
  const replyTo = cleanEmail(Deno.env.get('COMPLIANCE_EMAIL_REPLY_TO') || requesterEmail || 'rose@destinyhomesnj.com');
  const destination = replyTo || 'rose@destinyhomesnj.com';
  const requirement = 'Please ask your insurance agent to issue an updated certificate showing current General Liability coverage and naming Destiny Homes LLC, 102 Destiny Way, Lakewood, NJ 08701 as an additional insured. Please include Workers Compensation coverage when it applies to your business.';
  const subject = `${testMode ? '[TEST] ' : ''}${expired ? 'Expired insurance certificate - updated COI required' : 'Insurance certificate renewal requested'} - ${subcontractorName}`.slice(0, 240);
  const testHeader = testMode ? `TEST MODE - Intended subcontractor email: ${recipientEmail}\n\n` : '';
  const text = `${testHeader}Hello ${subcontractorName},\n\n${expirationLine}\n\n${requirement}\n\nA redacted sample certificate showing the requested format is attached. Please reply to this email with the renewed certificate, or send it to ${destination}.\n\nSincerely,\n\n${contactName}\nDestiny Homes LLC`;
  const htmlTestHeader = testMode ? `<p><strong>TEST MODE - Intended subcontractor email: ${escapeHtml(recipientEmail)}</strong></p>` : '';
  const html = `${htmlTestHeader}<p>Hello ${escapeHtml(subcontractorName)},</p><p>${escapeHtml(expirationLine)}</p><p>${escapeHtml(requirement)}</p><p>A redacted sample certificate showing the requested format is attached. Please reply to this email with the renewed certificate, or send it to ${escapeHtml(destination)}.</p><p>Sincerely,</p><p>${escapeHtml(contactName)}<br>Destiny Homes LLC</p>`;
  const attachments = [await loadComplianceAttachment('sample_coi')];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `${requestId}:certificate-renewal`,
    },
    body: JSON.stringify({
      from,
      to: [deliveryEmail],
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
  const respond = (body: Record<string, unknown>, status = 200) =>
    jsonResponse(body, status, requestId, corsHeaders);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: 'send-project-notification', operation, requestId, status });
    return respond({
      error,
      ...(code === 'app_writes_frozen' ? { code: 'APP_WRITES_FROZEN' } : {}),
    }, status);
  };
  let operation = 'request.initialize';

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, [REQUEST_ID_HEADER]: requestId } });
  }
  if (request.method !== 'POST') {
    return fail('Method not allowed.', 405, 'request.validate', 'method_not_allowed');
  }

  try {
    operation = 'configuration.read';
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const admin = createClient(supabaseUrl, serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    const callerToken = bearerToken(request);
    operation = 'auth.verify';
    const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
    const caller = callerData?.user;
    if (callerError || !caller?.id || !caller.email) {
      return fail('Unable to verify signed-in user.', 401, operation, 'invalid_token');
    }

    operation = 'maintenance.check';
    const runtimeStatus = await getAppRuntimeStatus(admin);
    if (runtimeStatus.writesFrozen) {
      return fail(maintenanceMessage(runtimeStatus), 503, operation, 'app_writes_frozen');
    }

    operation = 'request.validate';
    const payload = await request.json().catch(() => ({}));
    const eventId = String(payload.eventId || '').slice(0, 160);
    const projectId = String(payload.projectId || '').slice(0, 160);
    const kind = String(payload.kind || '');
    const entityId = String(payload.entityId || '').slice(0, 160);
    let taskAssignees = Array.isArray(payload.assignees)
      ? payload.assignees.map((value: unknown) => String(value || '').trim().slice(0, 240)).filter(Boolean).slice(0, 30)
      : [];
    let taskLabel = String(payload.taskLabel || '').trim().slice(0, 240);
    let taskDue = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.due || '')) ? String(payload.due) : '';
    const portfolioKind = kind === 'certificate-renewal-requested' || kind === 'subcontractor-compliance-requested';
    if (!eventId || !allowedKinds.has(kind) || (!projectId && kind !== 'task-created' && !portfolioKind) || ((kind === 'task-created' || portfolioKind) && !entityId)) {
      return fail('Invalid notification event.', 400, operation, 'invalid_event');
    }

    operation = 'users.read';
    const { data: appUsers, error: usersError } = await admin.from('app_users').select('id,position,data');
    if (usersError) throw usersError;
    const callerAppUser = (appUsers || []).find((user) =>
      String(user.data?.email || '').trim().toLowerCase() === String(caller.email).trim().toLowerCase(),
    );
    if (!callerAppUser || !['Admin', 'Edit'].includes(normalizeRole(callerAppUser.data?.role))) {
      return fail('Only project editors can send project notifications.', 403, 'authorization.check', 'editor_required');
    }

    let complianceEmailTestMode = false;
    let complianceDeliveryEmail = '';
    if (portfolioKind) {
      operation = 'compliance_email_settings.read';
      const { data: settingsRow, error: settingsError } = await admin
        .from('settings')
        .select('data')
        .eq('id', 'app_settings')
        .maybeSingle();
      if (settingsError) throw settingsError;
      complianceEmailTestMode = settingsRow?.data?.complianceEmailTestMode === true;
      if (complianceEmailTestMode) {
        if (normalizeRole(callerAppUser.data?.role) !== 'Admin') {
          return fail('Compliance email test mode is enabled. An administrator must send test emails.', 403, 'authorization.check', 'admin_test_sender_required');
        }
        complianceDeliveryEmail = cleanEmail(callerAppUser.data?.email || caller.email);
        if (!complianceDeliveryEmail) {
          return fail('Add a valid email address to your administrator account before using compliance email test mode.', 400, operation, 'admin_test_email_missing');
        }
      }
    }

    if (kind === 'subcontractor-compliance-requested') {
      operation = 'subcontractor_compliance.read';
      const [subcontractorResult, certificateResult, documentResult] = await Promise.all([
        admin.from('subs').select('id,data').eq('id', entityId).maybeSingle(),
        admin.from('insurance_certificates').select('id,effective_date,expiration_date').eq('subcontractor_id', entityId),
        admin.from('subcontractor_compliance_documents').select('document_type,source_path').eq('subcontractor_id', entityId),
      ]);
      if (subcontractorResult.error) throw subcontractorResult.error;
      if (certificateResult.error) throw certificateResult.error;
      if (documentResult.error) throw documentResult.error;
      const subcontractor = subcontractorResult.data;
      const recipientEmail = cleanEmail(subcontractor?.data?.email);
      if (!subcontractor || !recipientEmail) {
        return fail('Add a valid subcontractor email before sending a compliance request.', 400, operation, 'compliance_recipient_missing');
      }
      if (subcontractor.data?.inactive === true) {
        return fail('Compliance requests cannot be sent to an inactive subcontractor.', 400, operation, 'inactive_subcontractor');
      }

      const certificates = certificateResult.data || [];
      const certificateIds = certificates.map((certificate) => certificate.id);
      const coverageResult = certificateIds.length
        ? await admin.from('insurance_certificate_coverages')
          .select('certificate_id,coverage_type,effective_date,expiration_date')
          .in('certificate_id', certificateIds)
        : { data: [], error: null };
      if (coverageResult.error) throw coverageResult.error;
      const certificateById = new Map(certificates.map((certificate) => [certificate.id, certificate]));
      const today = new Date().toISOString().slice(0, 10);
      const currentCoverage = new Set<string>();
      const expirationDates = certificates.map((certificate) => validEmailDate(certificate.expiration_date)).filter(Boolean);
      (coverageResult.data || []).forEach((coverage) => {
        const type = normalizedCoverageType(coverage.coverage_type);
        if (!type) return;
        const parent = certificateById.get(coverage.certificate_id);
        const effectiveDate = validEmailDate(coverage.effective_date || parent?.effective_date);
        const expirationDate = validEmailDate(coverage.expiration_date || parent?.expiration_date);
        if (expirationDate) expirationDates.push(expirationDate);
        if ((!effectiveDate || effectiveDate <= today) && expirationDate && expirationDate >= today) currentCoverage.add(type);
      });
      const missing: string[] = [];
      if (!currentCoverage.has('general_liability')) missing.push('general_liability');
      const documentTypes = new Set((documentResult.data || [])
        .filter((document) => String(document.source_path || '').trim())
        .map((document) => String(document.document_type || '')));
      if (!documentTypes.has('subcontractor_agreement')) missing.push('subcontractor_agreement');
      const companyType = String(subcontractor.data?.companyType || '').trim();
      const w9Required = companyType
        ? is1099ReportingCompanyType(companyType)
        : subcontractor.data?.is1099Exempt !== true;
      if (w9Required && !documentTypes.has('w9')) missing.push('w9');
      if (!missing.length) return fail('This subcontractor is already compliant.', 409, operation, 'already_compliant');

      const latestExpirationDate = expirationDates.sort().at(-1) || '';
      const expiredCertificate = missing.includes('general_liability')
        && Boolean(latestExpirationDate && latestExpirationDate < today);
      operation = 'subcontractor_compliance.deliver';
      const emailResult = await sendSubcontractorComplianceEmail({
        requestId: eventId,
        recipientEmail,
        deliveryEmail: complianceEmailTestMode ? complianceDeliveryEmail : recipientEmail,
        subcontractorName: String(subcontractor.data?.company || `${subcontractor.data?.first || ''} ${subcontractor.data?.last || ''}`).trim() || 'Subcontractor',
        missing,
        latestExpirationDate,
        expiredCertificate,
        testMode: complianceEmailTestMode,
      });
      if (!emailResult.sent) {
        logEdgeFailure({
          code: emailResult.status === 'unconfigured' ? 'compliance_email_unconfigured' : 'compliance_email_failed',
          functionName: 'send-project-notification',
          operation,
          requestId,
          status: 200,
        });
      }
      return respond({
        ok: true,
        emailSent: emailResult.sent ? 1 : 0,
        emailFailed: emailResult.sent ? 0 : 1,
        emailStatus: emailResult.status,
        attachmentNames: emailResult.attachmentNames,
        requestType: expiredCertificate ? 'expired_certificate' : 'missing_compliance',
        testMode: complianceEmailTestMode,
      });
    }

    if (kind === 'certificate-renewal-requested') {
      operation = 'certificate_renewal.read';
      const renewalResult = await admin
        .from('certificate_renewal_requests')
        .select('id,subcontractor_id,source_certificate_id,recipient_email,delivery_status')
        .eq('id', entityId)
        .maybeSingle();
      if (renewalResult.error) throw renewalResult.error;
      const renewal = renewalResult.data;
      if (!renewal || renewal.id !== eventId) {
        return fail('Certificate renewal request not found.', 404, operation, 'renewal_not_found');
      }
      if (renewal.delivery_status === 'sent') {
        return respond({ ok: true, duplicate: true, emailSent: 0, emailFailed: 0, emailStatus: 'sent' });
      }

      const [subcontractorResult, certificateResult] = await Promise.all([
        admin.from('subs').select('id,data').eq('id', renewal.subcontractor_id).maybeSingle(),
        renewal.source_certificate_id
          ? admin.from('insurance_certificates').select('id,expiration_date').eq('id', renewal.source_certificate_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (subcontractorResult.error) throw subcontractorResult.error;
      if (certificateResult.error) throw certificateResult.error;
      const subcontractor = subcontractorResult.data;
      const recipientEmail = cleanEmail(renewal.recipient_email);
      if (!subcontractor || !recipientEmail) {
        return fail('The subcontractor does not have a valid renewal email address.', 400, operation, 'renewal_recipient_missing');
      }

      operation = 'certificate_renewal.deliver';
      const emailResult = await sendCertificateRenewalEmail({
        requestId: renewal.id,
        recipientEmail,
        deliveryEmail: complianceEmailTestMode ? complianceDeliveryEmail : recipientEmail,
        subcontractorName: String(subcontractor.data?.company || `${subcontractor.data?.first || ''} ${subcontractor.data?.last || ''}`).trim() || 'Subcontractor',
        expirationDate: String(certificateResult.data?.expiration_date || ''),
        requesterName: String(callerAppUser.data?.name || '').trim(),
        requesterEmail: String(callerAppUser.data?.email || caller.email || '').trim(),
        testMode: complianceEmailTestMode,
      });
      const { error: deliveryUpdateError } = await admin
        .from('certificate_renewal_requests')
        .update({
          delivery_status: emailResult.status,
          delivered_at: emailResult.sent ? new Date().toISOString() : null,
        })
        .eq('id', renewal.id);
      if (deliveryUpdateError) throw deliveryUpdateError;
      if (!emailResult.sent) {
        logEdgeFailure({
          code: emailResult.status === 'unconfigured' ? 'certificate_email_unconfigured' : 'certificate_email_failed',
          functionName: 'send-project-notification',
          operation,
          requestId,
          status: 200,
        });
      }
      return respond({
        ok: true,
        emailSent: emailResult.sent ? 1 : 0,
        emailFailed: emailResult.sent ? 0 : 1,
        emailStatus: emailResult.status,
        testMode: complianceEmailTestMode,
      });
    }

    if (kind === 'task-created' && !projectId) {
      operation = 'task_email.projectless_task.read';
      const [taskResult, assignmentResult, settingsResult, peopleResult] = await Promise.all([
        admin.from('tasks').select('id,data').eq('id', entityId).maybeSingle(),
        admin.from('task_assignments').select('assignee').eq('task_id', entityId).order('position'),
        admin.from('settings').select('data').eq('id', 'app_settings').maybeSingle(),
        admin.from('people').select('data,people_type'),
      ]);
      if (taskResult.error) throw taskResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (peopleResult.error) throw peopleResult.error;
      if (!taskResult.data || String(taskResult.data.data?.projectId || '').trim()) {
        return fail('Projectless task not found.', 400, operation, 'task_project_mismatch');
      }
      taskAssignees = (assignmentResult.data || [])
        .map((row) => String(row.assignee || '').trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 30);
      taskLabel = String(taskResult.data.data?.label || '').trim().slice(0, 240);
      taskDue = /^\d{4}-\d{2}-\d{2}$/.test(String(taskResult.data.data?.due || ''))
        ? String(taskResult.data.data.due)
        : '';
      const recipients = taskAssignees.length && taskLabel
        ? resolveTaskEmailRecipients({
          assignees: taskAssignees,
          settingsData: settingsResult.data?.data || {},
          appUsers: appUsers || [],
          people: peopleResult.data || [],
        })
        : [];
      operation = 'task_email.projectless_deliver';
      const emailResult = await sendTaskAssignmentEmails({
        recipients,
        eventId,
        projectId: '',
        taskId: entityId,
        projectName: 'General tasks',
        taskLabel,
        due: taskDue,
      });
      if (emailResult.failed) {
        logEdgeFailure({
          code: emailResult.status === 'unconfigured' ? 'task_email_unconfigured' : 'partial_delivery',
          functionName: 'send-project-notification',
          operation,
          requestId,
          status: 200,
        });
      }
      return respond({
        ok: true,
        sent: 0,
        failed: 0,
        emailSent: emailResult.sent,
        emailFailed: emailResult.failed,
        emailStatus: emailResult.status,
      });
    }

    operation = 'project.read';
    const [{ data: project }, { data: accessRows }] = await Promise.all([
      admin.from('projects').select('id,data').eq('id', projectId).maybeSingle(),
      admin.from('project_user_access').select('user_id').eq('project_id', projectId),
    ]);
    if (!project) return fail('Project not found.', 404, operation, 'project_not_found');
    const accessIds = new Set((accessRows || []).map((row) => row.user_id));
    const callerCanAccess = normalizeRole(callerAppUser.data?.role) === 'Admin'
      || (accessIds.size ? accessIds.has(callerAppUser.id) : normalizeRole(callerAppUser.data?.role) === 'Edit');
    if (!callerCanAccess) {
      return fail('You cannot notify users for this project.', 403, 'authorization.check', 'project_access_required');
    }

    let taskEmailRecipients: Array<{ email: string; name: string }> = [];
    if (kind === 'task-created') {
      operation = 'task_email.task.read';
      const [taskResult, assignmentResult] = await Promise.all([
        admin.from('tasks').select('id,data').eq('id', entityId).maybeSingle(),
        admin.from('task_assignments').select('assignee').eq('task_id', entityId).order('position'),
      ]);
      if (taskResult.error) throw taskResult.error;
      if (assignmentResult.error) throw assignmentResult.error;
      if (!taskResult.data || String(taskResult.data.data?.projectId || '') !== projectId) {
        return fail('Task not found for this project.', 400, operation, 'task_project_mismatch');
      }
      taskAssignees = (assignmentResult.data || [])
        .map((row) => String(row.assignee || '').trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 30);
      taskLabel = String(taskResult.data.data?.label || '').trim().slice(0, 240);
      taskDue = /^\d{4}-\d{2}-\d{2}$/.test(String(taskResult.data.data?.due || ''))
        ? String(taskResult.data.data.due)
        : '';
    }
    if (kind === 'task-created' && taskAssignees.length && taskLabel) {
      operation = 'task_email.recipients.read';
      const [settingsResult, peopleResult] = await Promise.all([
        admin.from('settings').select('data').eq('id', 'app_settings').maybeSingle(),
        admin.from('people').select('data,people_type'),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (peopleResult.error) throw peopleResult.error;
      taskEmailRecipients = resolveTaskEmailRecipients({
        assignees: taskAssignees,
        settingsData: settingsResult.data?.data || {},
        appUsers: appUsers || [],
        people: peopleResult.data || [],
      });
    }

    const requestedRecipients = new Set(
      Array.isArray(payload.recipientAppUserIds) ? payload.recipientAppUserIds.map(String) : [],
    );
    const selectionApprovalRequest = kind === 'selection-approval-requested';
    const recipientIds = (appUsers || [])
      .filter((user) => user.id !== callerAppUser.id)
      .filter((user) => selectionApprovalRequest
        ? normalizeRole(user.data?.role) === 'Customer' && accessIds.has(user.id)
        : normalizeRole(user.data?.role) === 'Admin'
          || (accessIds.size ? accessIds.has(user.id) : normalizeRole(user.data?.role) === 'Edit'))
      .filter((user) => !requestedRecipients.size || requestedRecipients.has(user.id))
      .map((user) => user.id);

    operation = 'notification.record';
    const { error: eventError } = await admin.from('push_notification_events').insert({
      id: eventId,
      actor_auth_user_id: caller.id,
      actor_app_user_id: callerAppUser.id,
      project_id: projectId,
      kind,
      entity_id: entityId,
      recipient_count: recipientIds.length + taskEmailRecipients.length,
    });
    if (eventError?.code === '23505') return respond({ ok: true, duplicate: true, sent: 0, emailSent: 0 });
    if (eventError) throw eventError;

    operation = 'task_email.deliver';
    const emailResult = await sendTaskAssignmentEmails({
      recipients: taskEmailRecipients,
      eventId,
      projectId,
      taskId: entityId,
      projectName: String(project.data?.name || 'Project').slice(0, 160),
      taskLabel,
      due: taskDue,
    });
    if (emailResult.status === 'unconfigured') {
      logEdgeFailure({
        code: 'task_email_unconfigured',
        functionName: 'send-project-notification',
        operation,
        requestId,
        status: 200,
      });
    }

    if (!recipientIds.length) {
      await admin.from('push_notification_events').update({
        sent_count: emailResult.sent,
        failed_count: emailResult.failed,
      }).eq('id', eventId);
      return respond({
        ok: true,
        sent: 0,
        failed: 0,
        emailSent: emailResult.sent,
        emailFailed: emailResult.failed,
        emailStatus: emailResult.status,
      });
    }
    operation = 'notification.tokens.read';
    const { data: tokenRows, error: tokenError } = await admin
      .from('device_push_tokens')
      .select('id,token')
      .in('app_user_id', recipientIds)
      .eq('enabled', true);
    if (tokenError) throw tokenError;
    if (!tokenRows?.length) {
      await admin.from('push_notification_events').update({
        sent_count: emailResult.sent,
        failed_count: emailResult.failed,
      }).eq('id', eventId);
      return respond({
        ok: true,
        sent: 0,
        failed: 0,
        emailSent: emailResult.sent,
        emailFailed: emailResult.failed,
        emailStatus: emailResult.status,
      });
    }

    operation = 'notification.deliver';
    const serviceAccount = JSON.parse(requiredEnv('FIREBASE_SERVICE_ACCOUNT_JSON'));
    const firebaseProjectId = serviceAccount.project_id || requiredEnv('FIREBASE_PROJECT_ID');
    const accessToken = await googleAccessToken(serviceAccount);
    const channelId = kind === 'inspection-updated' ? 'project-inspections-v2' : 'project-tasks-v2';
    const title = String(payload.title || project.data?.name || 'Project update').slice(0, 120);
    const body = String(payload.body || 'Project information changed.').slice(0, 300);
    const data = {
      kind,
      tab: String(payload.tab || 'projects'),
      detailTab: String(payload.detailTab || ''),
      projectId,
      entityId,
      selectionId: kind === 'selection-approval-requested' ? entityId : '',
      taskId: kind.startsWith('task-') ? entityId : '',
    };

    const results = await Promise.all(tokenRows.map(async (row) => {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: {
          token: row.token,
          notification: { title, body },
          data,
          android: {
            priority: 'normal',
            notification: { channel_id: channelId, visibility: 'PRIVATE', tag: `${kind}:${projectId}` },
          },
        } }),
      });
      const responseBody = await response.text();
      return { row, ok: response.ok, responseBody };
    }));
    const invalidTokenIds = results
      .filter((result) => !result.ok && /UNREGISTERED|registration-token-not-registered/i.test(result.responseBody))
      .map((result) => result.row.id);
    if (invalidTokenIds.length) await admin.from('device_push_tokens').delete().in('id', invalidTokenIds);
    const sent = results.filter((result) => result.ok).length;
    const failed = results.length - sent;
    operation = 'notification.record';
    await admin.from('push_notification_events').update({
      sent_count: sent + emailResult.sent,
      failed_count: failed + emailResult.failed,
    }).eq('id', eventId);
    if (failed || emailResult.failed) {
      logEdgeFailure({
        code: 'partial_delivery',
        functionName: 'send-project-notification',
        operation: 'notification.deliver',
        requestId,
        status: 200,
      });
    }
    return respond({
      ok: true,
      sent,
      failed,
      emailSent: emailResult.sent,
      emailFailed: emailResult.failed,
      emailStatus: emailResult.status,
    });
  } catch (error) {
    return fail(
      'Unexpected notification error.',
      500,
      operation,
      (error as { code?: unknown })?.code || 'unexpected_error',
    );
  }
});
