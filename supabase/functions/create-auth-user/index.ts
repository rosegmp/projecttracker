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

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function getServiceRoleKey() {
  const directKey =
    Deno.env.get('SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SECRET_KEY') ||
    Deno.env.get('SUPABASE_SERVICE_KEY');
  if (directKey) return directKey;

  const secretKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeysJson) {
    try {
      const parsed = JSON.parse(secretKeysJson);
      const parsedKey = parsed.service_role || parsed.service_role_key || parsed.secret || Object.values(parsed)[0];
      if (typeof parsedKey === 'string' && parsedKey) return parsedKey;
    } catch {
      // Fall through to the explicit error below.
    }
  }

  throw new Error('No Supabase service-role key is configured for this function.');
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function getBearerToken(request: Request) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const respond = (body: Record<string, unknown>, status = 200) =>
    jsonResponse(body, status, requestId, corsHeaders);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: 'create-auth-user', operation, requestId, status });
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
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const serviceRoleKey = getServiceRoleKey();
    const callerToken = getBearerToken(request);

    if (!callerToken) {
      return fail('Missing signed-in user token.', 401, 'auth.verify', 'missing_token');
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    operation = 'auth.verify';
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerToken);
    if (callerError || !callerData?.user?.email) {
      return fail('Unable to verify signed-in user.', 401, operation, 'invalid_token');
    }

    const callerEmail = normalizeEmail(callerData.user.email);
    operation = 'settings.read';
    const { data: settingsRow, error: settingsError } = await adminClient
      .from('settings')
      .select('data')
      .eq('id', 'app_settings')
      .maybeSingle();

    if (settingsError) {
      return fail('Unable to read app settings.', 500, operation, settingsError.code);
    }

    const appUsers = Array.isArray(settingsRow?.data?.users) ? settingsRow.data.users : [];
    const callerAppUser = appUsers.find((user) => normalizeEmail(user?.email) === callerEmail);

    if (normalizeRole(callerAppUser?.role) !== 'admin') {
      return fail('Only Admin users can invite authentication users.', 403, 'authorization.check', 'admin_required');
    }

    operation = 'request.validate';
    const payload = await request.json().catch(() => ({}));
    const email = normalizeEmail(payload.email);
    const name = String(payload.name || '').trim();
    const redirectTo = String(payload.redirectTo || '').trim();

    if (!email) {
      return fail('Email is required.', 400, operation, 'email_required');
    }

    operation = 'invite.send';
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: name ? { name } : undefined,
      redirectTo: redirectTo || undefined,
    });

    if (error) {
      return fail('Unable to send login invite.', 400, operation, error.code);
    }

    return respond({
      ok: true,
      user: {
        id: data.user?.id || '',
        email: data.user?.email || email,
      },
    });
  } catch (error) {
    return fail(
      'Unexpected function error.',
      500,
      operation,
      (error as { code?: unknown })?.code || 'unexpected_error',
    );
  }
});
