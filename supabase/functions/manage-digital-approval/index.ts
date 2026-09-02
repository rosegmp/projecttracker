import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
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

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || requiredEnv('SUPABASE_SECRET_KEY');
}

function publicClientKey() {
  return Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || requiredEnv('SUPABASE_KEY');
}

function bearerToken(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function cleanEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function escapeHtml(value: unknown) {
  return String(value || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return btoa(binary);
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicApproval(request: Record<string, unknown>, signedUrl = '') {
  const status = request.status === 'pending' && new Date(String(request.expires_at || '')).getTime() <= Date.now()
    ? 'expired'
    : request.status;
  return {
    id: request.id,
    title: request.title,
    status,
    expiresAt: request.expires_at,
    snapshot: request.snapshot,
    signerName: request.signer_name || '',
    signerEmail: request.signer_email || '',
    comment: request.decision_comment || '',
    respondedAt: request.responded_at || '',
    documentStatus: request.document_status || 'pending',
    signedPdfFileName: request.signed_pdf_file_name || '',
    signedUrl,
  };
}

function approvalLink(token: string) {
  return `https://projecthub.destinyhomesnj.com/#approval=${encodeURIComponent(token)}`;
}

async function sendApprovalEmail({
  requestId,
  request,
  token,
  senderEmail,
  testDeliveryEmail,
}: {
  requestId: string;
  request: Record<string, unknown>;
  token: string;
  senderEmail: string;
  testDeliveryEmail: string;
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  const from = Deno.env.get('TASK_ASSIGNMENT_EMAIL_FROM') || Deno.env.get('CERTIFICATE_RENEWAL_EMAIL_FROM') || '';
  const recipients = Array.isArray(request.recipientEmails)
    ? request.recipientEmails.map(cleanEmail).filter(Boolean)
    : [];
  if (!apiKey || !from) return { sent: 0, failed: recipients.length, status: 'unconfigured' };
  const deliveries = testDeliveryEmail ? [testDeliveryEmail] : recipients;
  const names = Array.isArray(request.recipientNames) ? request.recipientNames.map(String) : [];
  const link = approvalLink(token);
  const agreement = request.sourceType === 'subcontractor_agreement';
  const agreementBytes = agreement
    ? await Deno.readFile('./attachments/destiny-homes-subcontractor-agreement.pdf')
    : null;
  const subject = `${testDeliveryEmail ? '[TEST] ' : ''}Approval requested · ${String(request.title || 'Destiny Project Hub')}`.slice(0, 240);
  const results = await Promise.all(deliveries.map(async (email, index) => {
    const intended = recipients[Math.min(index, recipients.length - 1)] || '';
    const name = names[Math.min(index, names.length - 1)] || 'Recipient';
    const testHeader = testDeliveryEmail ? `TEST MODE - Intended recipient: ${intended}\n\n` : '';
    const text = `${testHeader}Hello ${name},\n\nDestiny Homes has sent an approval request for your review.\n\n${String(request.title || '')}\n\nReview and respond securely: ${link}\n\nThis private link expires on ${new Date(String(request.expiresAt)).toLocaleString('en-US')}. Do not forward it.\n\nDestiny Homes LLC`;
    const html = `${testDeliveryEmail ? `<p><strong>TEST MODE - Intended recipient: ${escapeHtml(intended)}</strong></p>` : ''}<p>Hello ${escapeHtml(name)},</p><p>Destiny Homes has sent an approval request for your review.</p><p><strong>${escapeHtml(request.title)}</strong></p><p><a href="${escapeHtml(link)}">Review and respond securely</a></p><p>This private link expires on ${escapeHtml(new Date(String(request.expiresAt)).toLocaleString('en-US'))}. Do not forward it.</p><p>Destiny Homes LLC</p>`;
    const cc = !testDeliveryEmail && senderEmail && !deliveries.includes(senderEmail) ? [senderEmail] : [];
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${requestId}:digital-approval:${index}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        ...(cc.length ? { cc } : {}),
        ...(senderEmail ? { reply_to: senderEmail } : {}),
        subject,
        text,
        html,
        ...(agreementBytes ? { attachments: [{ filename: 'Destiny Homes Subcontractor Agreement.pdf', content: bytesToBase64(agreementBytes) }] } : {}),
      }),
    });
    return response.ok;
  }));
  const sent = results.filter(Boolean).length;
  return { sent, failed: results.length - sent, status: sent === results.length ? 'sent' : sent ? 'partial' : 'failed' };
}

function safeFilePart(value: unknown) {
  return (String(value || 'approval').trim() || 'approval').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 100);
}

function displayLines(snapshot: Record<string, unknown>) {
  const kind = String(snapshot.kind || 'approval');
  if (kind === 'change_order') {
    const terms = (snapshot.changeOrderSnapshot || {}) as Record<string, unknown>;
    return [
      `Change order: ${terms.number || ''} ${terms.title || ''}`,
      `Scope: ${terms.description || 'Not provided'}`,
      `Reason: ${terms.reason || 'Not provided'}`,
      `Cost impact: ${terms.costImpact || 'Not provided'}`,
      `Schedule impact: ${terms.scheduleDays || 'None'} day(s)`,
      `Notes: ${terms.notes || 'None'}`,
    ];
  }
  if (kind === 'selection') {
    const terms = (snapshot.selectionSnapshot || {}) as Record<string, unknown>;
    return [
      `Selection: ${terms.itemName || snapshot.title || ''}`,
      `Chosen option: ${terms.chosenOption || 'Not provided'}`,
      `Vendor: ${terms.vendor || 'Not provided'}`,
      `Request: ${snapshot.message || ''}`,
    ];
  }
  if (kind === 'subcontractor_agreement') {
    return [`Company: ${snapshot.company || ''}`, `Contact: ${snapshot.contactName || ''}`];
  }
  return [`Request: ${snapshot.title || ''}`, `Message: ${snapshot.message || ''}`, `Due: ${snapshot.dueDate || 'Not set'}`];
}

function wrapText(text: string, max = 88) {
  const lines: string[] = [];
  String(text || '').split(/\r?\n/).forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    words.forEach((word) => {
      if (!line) line = word;
      else if (`${line} ${word}`.length <= max) line += ` ${word}`;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
  });
  return lines.length ? lines : [''];
}

async function buildSignedPdf(request: Record<string, unknown>) {
  const snapshot = (request.snapshot || {}) as Record<string, unknown>;
  const agreement = snapshot.kind === 'subcontractor_agreement';
  const pdf = agreement
    ? await PDFDocument.load(await Deno.readFile('./attachments/destiny-homes-subcontractor-agreement.pdf'))
    : await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 744;
  const draw = (text: string, size = 10, isBold = false, color = rgb(0.12, 0.15, 0.24)) => {
    wrapText(text, size >= 15 ? 64 : 88).forEach((line) => {
      page.drawText(line.replace(/[^\x20-\x7e]/g, ' '), { x: 48, y, size, font: isBold ? bold : regular, color });
      y -= size + 5;
    });
  };
  draw('DESTINY HOMES LLC', 18, true, rgb(0.24, 0.26, 0.47));
  draw('DIGITAL APPROVAL CERTIFICATE', 14, true);
  y -= 12;
  draw(String(request.title || 'Approval request'), 13, true);
  y -= 8;
  displayLines(snapshot).forEach((line) => { draw(line, 10); y -= 4; });
  y -= 12;
  draw(`Decision: ${String(request.status || '').toUpperCase()}`, 12, true,
    request.status === 'approved' ? rgb(0.08, 0.45, 0.28) : rgb(0.65, 0.16, 0.18));
  draw(`Signer: ${request.signer_name || ''}`, 10, true);
  draw(`Signer email: ${request.signer_email || ''}`);
  draw(`Timestamp: ${new Date(String(request.responded_at || Date.now())).toISOString()}`);
  draw(`Document version: ${request.source_version || 1}`);
  draw(`Approval request ID: ${request.id || ''}`);
  y -= 10;
  draw(`Comments: ${request.decision_comment || 'None'}`);
  y -= 14;
  draw('Electronic acknowledgment', 10, true);
  draw('The signer entered the name and email shown above and selected the recorded decision through a private, expiring approval link. This certificate is bound to the issued document snapshot and version.', 9);
  return pdf.save();
}

async function signedDownloadUrl(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  if (row.document_status !== 'ready' || !row.signed_pdf_path) return '';
  const result = await admin.storage.from(String(row.signed_pdf_bucket || 'certificate-files'))
    .createSignedUrl(String(row.signed_pdf_path), 600, { download: String(row.signed_pdf_file_name || 'signed-approval.pdf') });
  return result.data?.signedUrl || '';
}

async function finalizeSignedDocument(admin: ReturnType<typeof createClient>, decided: Record<string, unknown>) {
  const pdf = await buildSignedPdf(decided);
  const fileName = `${safeFilePart(decided.title)}-${String(decided.status)}-signed.pdf`;
  const path = `certificates/digital-approvals/${decided.id}/${fileName}`;
  const upload = await admin.storage.from('certificate-files').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
  if (upload.error) throw upload.error;
  const completion = await admin.rpc('complete_digital_approval_document', {
    p_request_id: decided.id,
    p_bucket: 'certificate-files',
    p_path: path,
    p_file_name: fileName,
  });
  if (completion.error) throw completion.error;
  return completion.data as Record<string, unknown>;
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const respond = (body: Record<string, unknown>, status = 200) => jsonResponse(body, status, requestId, corsHeaders);
  const fail = (message: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: 'manage-digital-approval', operation, requestId, status });
    return respond({ error: message }, status);
  };
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, [REQUEST_ID_HEADER]: requestId } });
  if (request.method !== 'POST') return fail('Method not allowed.', 405, 'request.validate', 'method_not_allowed');

  let operation = 'request.initialize';
  try {
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || '');
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const admin = createClient(supabaseUrl, serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });

    if (action === 'create') {
      operation = 'auth.verify';
      const callerToken = bearerToken(request);
      const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
      if (callerError || !callerData.user?.email) return fail('Sign in before sending an approval request.', 401, operation, 'invalid_token');
      const runtimeStatus = await getAppRuntimeStatus(admin);
      if (runtimeStatus.writesFrozen) return fail(maintenanceMessage(runtimeStatus), 503, 'maintenance.check', 'app_writes_frozen');
      const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const userClient = createClient(supabaseUrl, publicClientKey(), {
        global: { headers: { Authorization: `Bearer ${callerToken}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      operation = 'approval.create';
      const { data: created, error: createError } = await userClient.rpc('create_digital_approval_request', {
        p_source_type: String(payload.sourceType || ''),
        p_source_id: String(payload.sourceId || ''),
        p_source_version: Number(payload.sourceVersion) || 0,
        p_token: token,
        p_expires_at: new Date(Date.now() + Math.max(1, Math.min(30, Number(payload.expiresInDays) || 14)) * 86400000).toISOString(),
      });
      if (createError) return fail(createError.message, 400, operation, createError.code || 'create_failed');
      const sourceType = String(created?.sourceType || '');
      let testDeliveryEmail = '';
      if (sourceType === 'subcontractor_agreement') {
        const [{ data: settings }, { data: callerRow }] = await Promise.all([
          admin.from('settings').select('data').eq('id', 'app_settings').maybeSingle(),
          admin.from('app_users').select('data').ilike('data->>email', callerData.user.email).maybeSingle(),
        ]);
        if (settings?.data?.complianceEmailTestMode === true && callerRow?.data?.role === 'Admin') {
          testDeliveryEmail = cleanEmail(callerData.user.email);
        }
      }
      operation = 'approval.email';
      const delivery = await sendApprovalEmail({
        requestId,
        request: created,
        token,
        senderEmail: cleanEmail(callerData.user.email),
        testDeliveryEmail,
      });
      return respond({
        ok: true,
        request: created,
        delivery,
        emailStatus: delivery.status,
        testMode: !!testDeliveryEmail,
      });
    }

    const token = String(payload.token || '');
    if (!/^[A-Za-z0-9_-]{40,160}$/.test(token)) return fail('This approval link is invalid.', 400, 'token.validate', 'invalid_token');
    const hash = await tokenHash(token);
    operation = 'approval.read';
    const { data: loadedRow, error: readError } = await admin.from('digital_approval_requests').select('*').eq('token_hash', hash).maybeSingle();
    if (readError) throw readError;
    if (!loadedRow) return fail('This approval link is invalid.', 404, operation, 'not_found');
    let row = loadedRow as Record<string, unknown>;

    if (action === 'load') {
      if (['approved', 'declined'].includes(String(row.status)) && row.document_status !== 'ready') {
        operation = 'document.retry';
        try {
          row = await finalizeSignedDocument(admin, row);
        } catch (documentError) {
          await admin.from('digital_approval_requests').update({ document_status: 'failed' }).eq('id', row.id);
          row = { ...row, document_status: 'failed' };
          logEdgeFailure({ code: (documentError as { code?: unknown })?.code || 'document_retry_failed', functionName: 'manage-digital-approval', operation, requestId, status: 200 });
        }
      }
      const signedUrl = await signedDownloadUrl(admin, row);
      return respond({ approval: publicApproval(row, signedUrl) });
    }
    if (action !== 'respond') return fail('Unsupported approval action.', 400, 'request.validate', 'invalid_action');
    const runtimeStatus = await getAppRuntimeStatus(admin);
    if (runtimeStatus.writesFrozen) return fail(maintenanceMessage(runtimeStatus), 503, 'maintenance.check', 'app_writes_frozen');
    operation = 'approval.respond';
    const { data: decided, error: decisionError } = await admin.rpc('respond_to_digital_approval', {
      p_token_hash: hash,
      p_decision: String(payload.decision || ''),
      p_signer_name: String(payload.signerName || ''),
      p_signer_email: String(payload.signerEmail || ''),
      p_comment: String(payload.comment || ''),
    });
    if (decisionError) return fail(decisionError.message, decisionError.code === '42501' ? 403 : 400, operation, decisionError.code || 'decision_failed');

    operation = 'document.generate';
    try {
      const completed = await finalizeSignedDocument(admin, decided);
      const signedUrl = await signedDownloadUrl(admin, completed);
      return respond({ approval: publicApproval(completed, signedUrl) });
    } catch (documentError) {
      await admin.from('digital_approval_requests').update({ document_status: 'failed' }).eq('id', decided.id);
      logEdgeFailure({ code: (documentError as { code?: unknown })?.code || 'document_failed', functionName: 'manage-digital-approval', operation, requestId, status: 200 });
      return respond({ approval: publicApproval({ ...decided, document_status: 'failed' }), documentWarning: 'Your decision was recorded, but the signed PDF is still being prepared.' });
    }
  } catch (error) {
    return fail('Unexpected digital approval error.', 500, operation, (error as { code?: unknown })?.code || 'unexpected_error');
  }
});
