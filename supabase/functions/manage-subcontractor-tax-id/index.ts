import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  getRequestId,
  jsonResponse,
  logEdgeFailure,
  REQUEST_ID_HEADER,
} from '../_shared/requestCorrelation.ts';
import { getAppRuntimeStatus, maintenanceMessage } from '../_shared/maintenance.ts';

const FUNCTION_NAME = 'manage-subcontractor-tax-id';
const CERTIFICATE_BUCKET = 'certificate-files';
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const W9_COMPANY_TYPES = new Set([
  'Individual/sole proprietor or single-member LLC',
  'C Corporation',
  'S Corporation',
  'Partnership',
  'Trust/estate',
  'Limited Liability Company',
  'Other',
]);
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': `authorization, x-client-info, apikey, content-type, ${REQUEST_ID_HEADER}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': REQUEST_ID_HEADER,
};

const EXTRACTION_SYSTEM = `Extract the US taxpayer identification number from the supplied Form W-9.
Return only JSON with this exact shape:
{"taxId":"","taxIdType":"EIN|SSN|Unknown","legalName":"","businessName":"","mailingAddress":"","companyType":"Individual/sole proprietor or single-member LLC|C Corporation|S Corporation|Partnership|Trust/estate|Limited Liability Company|Other","confidence":"High|Medium|Low"}
Use legalName for line 1, businessName for line 2 when present, mailingAddress for the complete street, city, state, and ZIP address, and companyType for the checked federal tax classification on line 3a. For a checked Limited liability company box, return Limited Liability Company regardless of the C, S, or P entry on line 3b. Use an empty string when a field is absent. Do not include any other document text or explanation.`;

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeTaxId(value: unknown, requestedType: unknown = '') {
  const original = cleanText(value, 32);
  const digits = original.replace(/\D/g, '');
  if (digits.length !== 9) throw new Error('Enter a valid 9-digit US tax ID.');
  const suppliedType = cleanText(requestedType, 12).toLowerCase();
  const taxIdType = suppliedType === 'ein' || suppliedType === 'ssn'
    ? suppliedType
    : /^\d{2}-\d{7}$/.test(original)
      ? 'ein'
      : /^\d{3}-\d{2}-\d{4}$/.test(original)
        ? 'ssn'
        : 'unknown';
  return { digits, taxIdType, taxIdLastFour: digits.slice(-4) };
}

function normalizeCompanyType(value: unknown) {
  const text = cleanText(value, 100);
  return W9_COMPANY_TYPES.has(text) ? text : text ? 'Other' : '';
}

function parseExtraction(payload: Record<string, unknown>) {
  const text = Array.isArray(payload?.content)
    ? payload.content.map((item: Record<string, unknown>) => item?.type === 'text' ? String(item.text || '') : '').join('')
    : '';
  const parsed = JSON.parse(text.replace(/```json|```/gi, '').trim());
  const normalized = normalizeTaxId(parsed?.taxId, parsed?.taxIdType);
  return {
    ...normalized,
    legalName: cleanText(parsed?.legalName, 240),
    businessName: cleanText(parsed?.businessName, 240),
    mailingAddress: cleanText(parsed?.mailingAddress, 500),
    companyType: normalizeCompanyType(parsed?.companyType),
    confidence: ['High', 'Medium', 'Low'].includes(parsed?.confidence) ? parsed.confidence : 'Low',
  };
}

async function encryptTaxId(taxId: string, subcontractorId: string) {
  const keyBytes = base64ToBytes(requiredEnv('TAX_ID_ENCRYPTION_KEY_V1'));
  if (keyBytes.byteLength !== 32) throw new Error('TAX_ID_ENCRYPTION_KEY_V1 must contain exactly 32 bytes.');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(taxId);
  const additionalData = new TextEncoder().encode(`subcontractor:${subcontractorId}`);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plaintext);
  return {
    encryptedTaxId: bytesToBase64(new Uint8Array(ciphertext)),
    encryptionIv: bytesToBase64(iv),
  };
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const respond = (body: Record<string, unknown>, status = 200) => jsonResponse(body, status, requestId, corsHeaders);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: FUNCTION_NAME, operation, requestId, status });
    return respond({ error, ...(code === 'app_writes_frozen' ? { code: 'APP_WRITES_FROZEN' } : {}) }, status);
  };
  let operation = 'request.initialize';

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: { ...corsHeaders, [REQUEST_ID_HEADER]: requestId } });
  }
  if (request.method !== 'POST') return fail('Method not allowed.', 405, 'request.validate', 'method_not_allowed');

  try {
    operation = 'configuration.read';
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const admin = createClient(supabaseUrl, serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });

    operation = 'auth.verify';
    const { data: callerData, error: callerError } = await admin.auth.getUser(bearerToken(request));
    const caller = callerData?.user;
    if (callerError || !caller?.id || !caller.email) {
      return fail('Unable to verify signed-in user.', 401, operation, 'invalid_token');
    }

    operation = 'maintenance.check';
    const runtimeStatus = await getAppRuntimeStatus(admin);
    if (runtimeStatus.writesFrozen) return fail(maintenanceMessage(runtimeStatus), 503, operation, 'app_writes_frozen');

    operation = 'authorization.check';
    const { data: appUsers, error: usersError } = await admin.from('app_users').select('data');
    if (usersError) return fail('Unable to verify tax ID permissions.', 500, operation, usersError.code);
    const callerEmail = String(caller.email).trim().toLowerCase();
    const callerAppUser = (appUsers || []).find((user) => String(user.data?.email || '').trim().toLowerCase() === callerEmail);
    if (!callerAppUser || !['Admin', 'Edit'].includes(String(callerAppUser.data?.role || '').trim())) {
      return fail('Only internal editors can store subcontractor tax IDs.', 403, operation, 'editor_required');
    }

    operation = 'request.validate';
    const body = await request.json().catch(() => ({}));
    const action = cleanText(body?.action, 20);
    const subcontractorId = cleanText(body?.subcontractorId, 200);
    const { data: subcontractor, error: subcontractorError } = await admin.from('subs').select('id').eq('id', subcontractorId).maybeSingle();
    if (subcontractorError || !subcontractor) return fail('Select a valid subcontractor.', 400, operation, subcontractorError?.code || 'invalid_subcontractor');

    let normalized: {
      digits: string;
      taxIdType: string;
      taxIdLastFour: string;
      legalName?: string;
      businessName?: string;
      mailingAddress?: string;
      companyType?: string;
      confidence?: string;
    };
    let source: 'manual' | 'w9_extraction';
    if (action === 'manual') {
      normalized = normalizeTaxId(body?.taxId, body?.taxIdType);
      normalized.confidence = '';
      const { data: existing } = await admin.from('subcontractor_tax_identifiers')
        .select('legal_name,business_name,mailing_address')
        .eq('subcontractor_id', subcontractorId)
        .maybeSingle();
      normalized.legalName = cleanText(existing?.legal_name, 240);
      normalized.businessName = cleanText(existing?.business_name, 240);
      normalized.mailingAddress = cleanText(existing?.mailing_address, 500);
      source = 'manual';
    } else if (action === 'extract') {
      const anthropicKey = requiredEnv('ANTHROPIC_API_KEY');
      const anthropicModel = requiredEnv('ANTHROPIC_CERTIFICATE_MODEL');
      const sourcePath = cleanText(body?.sourcePath, 600);
      const requestedContentType = cleanText(body?.contentType, 100).toLowerCase();
      if (!sourcePath.startsWith(`certificates/${caller.id}/`) || sourcePath.includes('..')) {
        return fail('Invalid Form W-9 file.', 400, operation, 'invalid_path');
      }
      if (!ALLOWED_TYPES.has(requestedContentType)) return fail('Unsupported Form W-9 file type.', 400, operation, 'invalid_file_type');

      operation = 'storage.download';
      const { data: storedFile, error: downloadError } = await admin.storage.from(CERTIFICATE_BUCKET).download(sourcePath);
      if (downloadError || !storedFile) return fail('Unable to read the Form W-9 file.', 404, operation, downloadError?.message || 'not_found');
      if (storedFile.size > MAX_FILE_BYTES) return fail('Form W-9 file is too large.', 400, operation, 'file_too_large');
      const contentType = cleanText(storedFile.type || requestedContentType, 100).toLowerCase();
      if (!ALLOWED_TYPES.has(contentType)) return fail('Unsupported Form W-9 file type.', 400, operation, 'invalid_stored_file_type');

      operation = 'provider.extract';
      const bytes = new Uint8Array(await storedFile.arrayBuffer());
      const contentBlock = contentType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: contentType, data: bytesToBase64(bytes) } }
        : { type: 'image', source: { type: 'base64', media_type: contentType, data: bytesToBase64(bytes) } };
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': Deno.env.get('ANTHROPIC_VERSION') || '2023-06-01',
          'x-api-key': anthropicKey,
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 280,
          system: EXTRACTION_SYSTEM,
          messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'Extract the tax ID from this Form W-9.' }] }],
        }),
      });
      if (!upstream.ok) return fail('Tax ID extraction provider rejected the request.', 502, operation, `provider_${upstream.status}`);
      operation = 'response.validate';
      try {
        normalized = parseExtraction(await upstream.json());
      } catch {
        return fail('No valid tax ID could be extracted. Enter it manually.', 422, operation, 'tax_id_not_found');
      }
      source = 'w9_extraction';
    } else {
      return fail('Select a valid tax ID action.', 400, operation, 'invalid_action');
    }

    operation = 'tax-id.encrypt';
    const encrypted = await encryptTaxId(normalized.digits, subcontractorId);
    operation = 'tax-id.store';
    const { error: saveError } = await admin.from('subcontractor_tax_identifiers').upsert({
      subcontractor_id: subcontractorId,
      encrypted_tax_id: encrypted.encryptedTaxId,
      encryption_iv: encrypted.encryptionIv,
      encryption_key_version: 1,
      tax_id_last_four: normalized.taxIdLastFour,
      tax_id_type: normalized.taxIdType,
      legal_name: normalized.legalName || '',
      business_name: normalized.businessName || '',
      mailing_address: normalized.mailingAddress || '',
      source,
      extraction_confidence: normalized.confidence || '',
      created_by: caller.id,
      updated_by: caller.id,
    }, { onConflict: 'subcontractor_id' });
    if (saveError) return fail('Unable to store the encrypted tax ID.', 500, operation, saveError.code);

    return respond({
      taxIdLastFour: normalized.taxIdLastFour,
      taxIdType: normalized.taxIdType,
      legalName: normalized.legalName || '',
      businessName: normalized.businessName || '',
      mailingAddress: normalized.mailingAddress || '',
      companyType: normalized.companyType || '',
      source,
      confidence: normalized.confidence || '',
    });
  } catch (error) {
    return fail('Unable to store the subcontractor tax ID.', 500, operation, error instanceof Error ? error.name : 'unknown');
  }
});
