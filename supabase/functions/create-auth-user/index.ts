import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

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
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const supabaseUrl = getRequiredEnv('SUPABASE_URL');
    const serviceRoleKey = getServiceRoleKey();
    const callerToken = getBearerToken(request);

    if (!callerToken) {
      return jsonResponse({ error: 'Missing signed-in user token.' }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerToken);
    if (callerError || !callerData?.user?.email) {
      return jsonResponse({ error: 'Unable to verify signed-in user.' }, 401);
    }

    const callerEmail = normalizeEmail(callerData.user.email);
    const { data: settingsRow, error: settingsError } = await adminClient
      .from('settings')
      .select('data')
      .eq('id', 'app_settings')
      .maybeSingle();

    if (settingsError) {
      return jsonResponse({ error: `Unable to read app settings: ${settingsError.message}` }, 500);
    }

    const appUsers = Array.isArray(settingsRow?.data?.users) ? settingsRow.data.users : [];
    const callerAppUser = appUsers.find((user) => normalizeEmail(user?.email) === callerEmail);

    if (normalizeRole(callerAppUser?.role) !== 'admin') {
      return jsonResponse({ error: 'Only Admin users can invite authentication users.' }, 403);
    }

    const payload = await request.json().catch(() => ({}));
    const email = normalizeEmail(payload.email);
    const name = String(payload.name || '').trim();
    const redirectTo = String(payload.redirectTo || '').trim();

    if (!email) {
      return jsonResponse({ error: 'Email is required.' }, 400);
    }

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: name ? { name } : undefined,
      redirectTo: redirectTo || undefined,
    });

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({
      ok: true,
      user: {
        id: data.user?.id || '',
        email: data.user?.email || email,
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unexpected function error.',
      },
      500,
    );
  }
});
