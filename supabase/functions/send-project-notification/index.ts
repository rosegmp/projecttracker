import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  getRequestId,
  jsonResponse,
  logEdgeFailure,
  REQUEST_ID_HEADER,
} from '../_shared/requestCorrelation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': `authorization, x-client-info, apikey, content-type, ${REQUEST_ID_HEADER}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
};
const allowedKinds = new Set(['task-created', 'task-updated', 'task-assigned', 'inspection-updated', 'comment-mentioned', 'selection-approval-requested']);
let cachedGoogleToken: { value: string; expiresAt: number } | null = null;

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

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const respond = (body: Record<string, unknown>, status = 200) =>
    jsonResponse(body, status, requestId, corsHeaders);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: 'send-project-notification', operation, requestId, status });
    return respond({ error }, status);
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

    operation = 'request.validate';
    const payload = await request.json().catch(() => ({}));
    const eventId = String(payload.eventId || '').slice(0, 160);
    const projectId = String(payload.projectId || '').slice(0, 160);
    const kind = String(payload.kind || '');
    if (!eventId || !projectId || !allowedKinds.has(kind)) {
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
      entity_id: String(payload.entityId || '').slice(0, 160),
      recipient_count: recipientIds.length,
    });
    if (eventError?.code === '23505') return respond({ ok: true, duplicate: true, sent: 0 });
    if (eventError) throw eventError;

    if (!recipientIds.length) return respond({ ok: true, sent: 0 });
    operation = 'notification.tokens.read';
    const { data: tokenRows, error: tokenError } = await admin
      .from('device_push_tokens')
      .select('id,token')
      .in('app_user_id', recipientIds)
      .eq('enabled', true);
    if (tokenError) throw tokenError;
    if (!tokenRows?.length) return respond({ ok: true, sent: 0 });

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
      entityId: String(payload.entityId || ''),
      selectionId: kind === 'selection-approval-requested' ? String(payload.entityId || '') : '',
      taskId: kind.startsWith('task-') ? String(payload.entityId || '') : '',
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
    await admin.from('push_notification_events').update({ sent_count: sent, failed_count: failed }).eq('id', eventId);
    if (failed) {
      logEdgeFailure({
        code: 'partial_delivery',
        functionName: 'send-project-notification',
        operation: 'notification.deliver',
        requestId,
        status: 200,
      });
    }
    return respond({ ok: true, sent, failed });
  } catch (error) {
    return fail(
      'Unexpected notification error.',
      500,
      operation,
      (error as { code?: unknown })?.code || 'unexpected_error',
    );
  }
});
