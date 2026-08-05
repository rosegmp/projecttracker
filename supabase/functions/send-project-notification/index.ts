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
    if (!eventId || !allowedKinds.has(kind) || (!projectId && kind !== 'task-created') || (kind === 'task-created' && !entityId)) {
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
