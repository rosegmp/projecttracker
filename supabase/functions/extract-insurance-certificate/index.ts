import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  getRequestId,
  jsonResponse,
  logEdgeFailure,
  REQUEST_ID_HEADER,
} from '../_shared/requestCorrelation.ts';

const FUNCTION_NAME = 'extract-insurance-certificate';
const CERTIFICATE_BUCKET = 'certificate-files';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': `authorization, x-client-info, apikey, content-type, ${REQUEST_ID_HEADER}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
};

const EXTRACTION_SYSTEM = `Extract insurance certificate data from the supplied document.
Return only JSON with this exact shape:
{"subcontractorName":"","holder":"","insured":"","insurer":"","policyNumber":"","effectiveDate":"YYYY-MM-DD","expirationDate":"YYYY-MM-DD","additionalInsured":false,"coverages":[{"type":"","generalLimit":0,"aggregateLimit":0,"effectiveDate":"YYYY-MM-DD","expirationDate":"YYYY-MM-DD"}],"confidence":"High|Medium|Low","extractionNotes":""}
Use an empty string when text is not present. Use 0 when a coverage limit is not present. For each coverage, return only the primary general, each-occurrence, or equivalent limit as generalLimit and the overall aggregate as aggregateLimit; omit other sublimits. Recognize General Aggregate, Policy Aggregate, Annual Aggregate, Total Aggregate, and close equivalent wording as aggregate values. When both General Aggregate and Products-Completed Operations Aggregate are present, prefer General Aggregate. Extract the effective and expiration dates for each distinct coverage, including Commercial General Liability and Workers Compensation. Do not infer an additional-insured endorsement unless the document indicates it. Preserve each distinct coverage type as a separate coverages entry.`;

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function serviceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SERVICE_ROLE_KEY') ||
    requiredEnv('SUPABASE_SECRET_KEY');
}

function bearerToken(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanDate(value: unknown) {
  const text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseExtraction(payload: Record<string, unknown>) {
  const text = Array.isArray(payload?.content)
    ? payload.content.map((item: Record<string, unknown>) => item?.type === 'text' ? String(item.text || '') : '').join('')
    : '';
  const parsed = JSON.parse(text.replace(/```json|```/gi, '').trim());
  const coverages = Array.isArray(parsed?.coverages)
    ? parsed.coverages
      .map((coverage: Record<string, unknown>) => ({
        type: cleanText(coverage?.type, 120),
        generalLimit: Math.max(0, Number(coverage?.generalLimit ?? coverage?.amount) || 0),
        aggregateLimit: Math.max(0, Number(coverage?.aggregateLimit) || 0),
        effectiveDate: cleanDate(coverage?.effectiveDate),
        expirationDate: cleanDate(coverage?.expirationDate),
      }))
      .filter((coverage: { type: string }) => coverage.type)
      .slice(0, 20)
    : [];

  return {
    subcontractorName: cleanText(parsed?.subcontractorName, 240),
    holder: cleanText(parsed?.holder, 240),
    insured: cleanText(parsed?.insured, 240),
    insurer: cleanText(parsed?.insurer, 240),
    policyNumber: cleanText(parsed?.policyNumber, 160),
    effectiveDate: cleanDate(parsed?.effectiveDate),
    expirationDate: cleanDate(parsed?.expirationDate),
    additionalInsured: parsed?.additionalInsured === true,
    coverages,
    confidence: ['High', 'Medium', 'Low'].includes(parsed?.confidence) ? parsed.confidence : 'Low',
    extractionNotes: cleanText(parsed?.extractionNotes, 500),
  };
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const respond = (body: Record<string, unknown>, status = 200) =>
    jsonResponse(body, status, requestId, corsHeaders);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: FUNCTION_NAME, operation, requestId, status });
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
    const anthropicKey = requiredEnv('ANTHROPIC_API_KEY');
    const anthropicModel = requiredEnv('ANTHROPIC_CERTIFICATE_MODEL');
    const anthropicVersion = Deno.env.get('ANTHROPIC_VERSION') || '2023-06-01';
    const admin = createClient(supabaseUrl, serviceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    operation = 'auth.verify';
    const callerToken = bearerToken(request);
    const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
    const caller = callerData?.user;
    if (callerError || !caller?.id || !caller.email) {
      return fail('Unable to verify signed-in user.', 401, operation, 'invalid_token');
    }

    operation = 'authorization.check';
    const { data: appUsers, error: usersError } = await admin.from('app_users').select('data');
    if (usersError) return fail('Unable to verify certificate permissions.', 500, operation, usersError.code);
    const callerEmail = String(caller.email).trim().toLowerCase();
    const callerAppUser = (appUsers || []).find((user) =>
      String(user.data?.email || '').trim().toLowerCase() === callerEmail
    );
    if (!callerAppUser || !['Admin', 'Edit'].includes(String(callerAppUser.data?.role || '').trim())) {
      return fail('Only internal editors can extract insurance certificates.', 403, operation, 'editor_required');
    }

    operation = 'request.validate';
    const body = await request.json().catch(() => ({}));
    const sourcePath = cleanText(body?.sourcePath, 600);
    const requestedType = cleanText(body?.contentType, 100).toLowerCase();
    const requiredPrefix = `certificates/${caller.id}/`;
    if (!sourcePath.startsWith(requiredPrefix) || sourcePath.includes('..')) {
      return fail('Invalid certificate file.', 400, operation, 'invalid_path');
    }
    if (!ALLOWED_TYPES.has(requestedType)) {
      return fail('Unsupported certificate file type.', 400, operation, 'invalid_file_type');
    }

    operation = 'storage.download';
    const { data: storedFile, error: downloadError } = await admin.storage
      .from(CERTIFICATE_BUCKET)
      .download(sourcePath);
    if (downloadError || !storedFile) {
      return fail('Unable to read the certificate file.', 404, operation, downloadError?.message || 'not_found');
    }
    if (storedFile.size > MAX_FILE_BYTES) {
      return fail('Certificate file is too large.', 400, operation, 'file_too_large');
    }
    const contentType = cleanText(storedFile.type || requestedType, 100).toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return fail('Unsupported certificate file type.', 400, operation, 'invalid_stored_file_type');
    }

    operation = 'provider.extract';
    const bytes = new Uint8Array(await storedFile.arrayBuffer());
    const contentBlock = contentType === 'application/pdf'
      ? {
        type: 'document',
        source: { type: 'base64', media_type: contentType, data: bytesToBase64(bytes) },
      }
      : {
        type: 'image',
        source: { type: 'base64', media_type: contentType, data: bytesToBase64(bytes) },
      };
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': anthropicVersion,
        'x-api-key': anthropicKey,
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 1400,
        system: EXTRACTION_SYSTEM,
        messages: [{
          role: 'user',
          content: [contentBlock, { type: 'text', text: 'Extract this insurance certificate for human review.' }],
        }],
      }),
    });
    if (!upstream.ok) {
      return fail('Certificate extraction provider rejected the request.', 502, operation, `provider_${upstream.status}`);
    }

    operation = 'response.validate';
    const providerPayload = await upstream.json();
    try {
      return respond(parseExtraction(providerPayload));
    } catch {
      return fail('Certificate extraction returned an invalid result.', 502, operation, 'invalid_provider_response');
    }
  } catch (error) {
    return fail('Certificate extraction failed.', 500, operation, error instanceof Error ? error.name : 'unknown');
  }
});
