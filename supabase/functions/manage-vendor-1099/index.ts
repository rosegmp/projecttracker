import { createClient } from 'npm:@supabase/supabase-js@2';
import { getRequestId, jsonResponse, logEdgeFailure, REQUEST_ID_HEADER } from '../_shared/requestCorrelation.ts';
import { getAppRuntimeStatus, maintenanceMessage } from '../_shared/maintenance.ts';

const FUNCTION_NAME = 'manage-vendor-1099';
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

function bearerToken(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

function cleanText(value: unknown, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const bytes = base64ToBytes(requiredEnv('TAX_ID_ENCRYPTION_KEY_V1'));
  if (bytes.byteLength !== 32) throw new Error('TAX_ID_ENCRYPTION_KEY_V1 must contain exactly 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptValue(value: string, aad: string) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(value));
  return { encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptValue(encrypted: string, iv: string, aad: string) {
  const key = await encryptionKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv), additionalData: new TextEncoder().encode(aad) }, key, base64ToBytes(encrypted));
  return new TextDecoder().decode(decrypted);
}

function payerSummary(row: Record<string, unknown> | null) {
  return row ? {
    configured: Boolean(row.encrypted_tax_id && row.legal_name && row.mailing_address && row.contact_email),
    legalName: cleanText(row.legal_name, 240),
    businessName: cleanText(row.business_name, 240),
    mailingAddress: cleanText(row.mailing_address),
    phone: cleanText(row.phone, 40),
    contactEmail: cleanText(row.contact_email, 254),
    taxIdLastFour: cleanText(row.tax_id_last_four, 4),
    updatedAt: cleanText(row.updated_at, 40),
  } : { configured: false, legalName: '', businessName: '', mailingAddress: '', phone: '', contactEmail: '', taxIdLastFour: '', updatedAt: '' };
}

Deno.serve(async (request) => {
  const requestId = getRequestId(request);
  const respond = (body: Record<string, unknown>, status = 200) => jsonResponse(body, status, requestId, corsHeaders);
  const fail = (error: string, status: number, operation: string, code: unknown) => {
    logEdgeFailure({ code, functionName: FUNCTION_NAME, operation, requestId, status });
    return respond({ error, ...(code === 'app_writes_frozen' ? { code: 'APP_WRITES_FROZEN' } : {}) }, status);
  };
  let operation = 'request.initialize';
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { ...corsHeaders, [REQUEST_ID_HEADER]: requestId } });
  if (request.method !== 'POST') return fail('Method not allowed.', 405, 'request.validate', 'method_not_allowed');

  try {
    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const admin = createClient(supabaseUrl, serviceRoleKey(), { auth: { autoRefreshToken: false, persistSession: false } });
    operation = 'auth.verify';
    const { data: callerData, error: callerError } = await admin.auth.getUser(bearerToken(request));
    const caller = callerData?.user;
    if (callerError || !caller?.id || !caller.email) return fail('Unable to verify signed-in user.', 401, operation, 'invalid_token');

    operation = 'authorization.check';
    const { data: appUsers, error: usersError } = await admin.from('app_users').select('data');
    if (usersError) return fail('Unable to verify 1099 permissions.', 500, operation, usersError.code);
    const email = caller.email.trim().toLowerCase();
    const appUser = (appUsers || []).find((item) => String(item.data?.email || '').trim().toLowerCase() === email);
    if (String(appUser?.data?.role || '') !== 'Admin') return fail('Only administrators can manage 1099 filings.', 403, operation, 'admin_required');

    const body = await request.json().catch(() => ({}));
    const action = cleanText(body?.action, 40);
    if (action !== 'get-workspace') {
      operation = 'maintenance.check';
      const runtime = await getAppRuntimeStatus(admin);
      if (runtime.writesFrozen) return fail(maintenanceMessage(runtime), 503, operation, 'app_writes_frozen');
    }

    if (action === 'get-workspace') {
      operation = 'workspace.read';
      const [{ data: payer, error: payerError }, { data: batches, error: batchesError }, { data: forms, error: formsError }] = await Promise.all([
        admin.from('vendor_1099_payer_profiles').select('legal_name,business_name,mailing_address,phone,contact_email,tax_id_last_four,encrypted_tax_id,updated_at').eq('id', true).maybeSingle(),
        admin.from('vendor_1099_filing_batches').select('id,tax_year,status,federal_method,new_jersey_method,federal_confirmation,new_jersey_confirmation,submitted_at,accepted_at,created_at,updated_at').order('created_at', { ascending: false }).limit(20),
        admin.from('vendor_1099_forms').select('batch_id,federal_status,new_jersey_status,delivery_status,compensation'),
      ]);
      if (payerError || batchesError || formsError) return fail('Unable to load the 1099 filing workspace.', 500, operation, payerError?.code || batchesError?.code || formsError?.code);
      const formsByBatch = new Map<string, Record<string, unknown>[]>();
      (forms || []).forEach((form) => formsByBatch.set(String(form.batch_id), [...(formsByBatch.get(String(form.batch_id)) || []), form]));
      return respond({ payer: payerSummary(payer), batches: (batches || []).map((batch) => {
        const batchForms = formsByBatch.get(String(batch.id)) || [];
        return {
          id: batch.id, taxYear: batch.tax_year, status: batch.status, federalMethod: batch.federal_method,
          newJerseyMethod: batch.new_jersey_method, federalConfirmation: batch.federal_confirmation,
          newJerseyConfirmation: batch.new_jersey_confirmation, submittedAt: batch.submitted_at,
          acceptedAt: batch.accepted_at, createdAt: batch.created_at, updatedAt: batch.updated_at,
          formCount: batchForms.length,
          totalCompensation: batchForms.reduce((sum, form) => sum + Number(form.compensation || 0), 0),
          deliveryCounts: batchForms.reduce((result: Record<string, number>, form) => ({ ...result, [String(form.delivery_status)]: (result[String(form.delivery_status)] || 0) + 1 }), {}),
        };
      }) });
    }

    if (action === 'save-payer') {
      operation = 'payer.validate';
      const legalName = cleanText(body?.legalName, 240);
      const businessName = cleanText(body?.businessName, 240);
      const mailingAddress = cleanText(body?.mailingAddress, 500);
      const phone = cleanText(body?.phone, 40);
      const contactEmail = cleanText(body?.contactEmail, 254).toLowerCase();
      const taxId = cleanText(body?.taxId, 32).replace(/\D/g, '');
      if (!legalName || !mailingAddress || !/^\S+@\S+\.\S+$/.test(contactEmail)) return fail('Enter the payer legal name, complete address, and contact email.', 400, operation, 'invalid_payer');
      const { data: existing } = await admin.from('vendor_1099_payer_profiles').select('encrypted_tax_id,encryption_iv,tax_id_last_four').eq('id', true).maybeSingle();
      let encryptedTaxId = String(existing?.encrypted_tax_id || '');
      let encryptionIv = String(existing?.encryption_iv || '');
      let lastFour = String(existing?.tax_id_last_four || '');
      if (taxId) {
        if (taxId.length !== 9) return fail('Enter a valid 9-digit payer EIN.', 400, operation, 'invalid_ein');
        const encrypted = await encryptValue(taxId, '1099-payer:default');
        encryptedTaxId = encrypted.encrypted;
        encryptionIv = encrypted.iv;
        lastFour = taxId.slice(-4);
      }
      if (!encryptedTaxId) return fail('Enter the payer EIN.', 400, operation, 'payer_ein_required');
      operation = 'payer.save';
      const { data: saved, error } = await admin.from('vendor_1099_payer_profiles').upsert({
        id: true, legal_name: legalName, business_name: businessName, mailing_address: mailingAddress,
        phone, contact_email: contactEmail, encrypted_tax_id: encryptedTaxId, encryption_iv: encryptionIv,
        encryption_key_version: 1, tax_id_last_four: lastFour, updated_by: caller.id, updated_at: new Date().toISOString(),
      }).select('legal_name,business_name,mailing_address,phone,contact_email,tax_id_last_four,encrypted_tax_id,updated_at').single();
      if (error) return fail('Unable to save the payer profile.', 500, operation, error.code);
      return respond({ payer: payerSummary(saved) });
    }

    if (action === 'create-batch') {
      operation = 'batch.validate';
      const taxYear = Number(body?.taxYear);
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > new Date().getFullYear() + 1) return fail('Select a valid tax year.', 400, operation, 'invalid_year');
      if (!rows.length || rows.length > 500) return fail('Choose between 1 and 500 ready vendors.', 400, operation, 'invalid_rows');
      const [{ data: payer }, { data: subs }, { data: identifiers }] = await Promise.all([
        admin.from('vendor_1099_payer_profiles').select('*').eq('id', true).maybeSingle(),
        admin.from('subs').select('id,data').in('id', rows.map((row: Record<string, unknown>) => cleanText(row.subcontractorId, 200))),
        admin.from('subcontractor_tax_identifiers').select('*').in('subcontractor_id', rows.map((row: Record<string, unknown>) => cleanText(row.subcontractorId, 200))),
      ]);
      if (!payerSummary(payer).configured) return fail('Complete the payer profile before creating a filing batch.', 400, operation, 'payer_incomplete');
      const subById = new Map((subs || []).map((sub) => [String(sub.id), sub]));
      const idBySub = new Map((identifiers || []).map((identifier) => [String(identifier.subcontractor_id), identifier]));
      const batchId = crypto.randomUUID();
      const forms = [];
      for (const input of rows as Record<string, unknown>[]) {
        const subcontractorId = cleanText(input.subcontractorId, 200);
        const compensation = Math.round(Number(input.compensation || 0) * 100) / 100;
        const sub = subById.get(subcontractorId);
        const identifier = idBySub.get(subcontractorId);
        const vendorName = cleanText(identifier?.legal_name || sub?.data?.legalName || sub?.data?.company || `${sub?.data?.first || ''} ${sub?.data?.last || ''}`, 240);
        const vendorAddress = cleanText(identifier?.mailing_address, 500);
        if (!sub || !identifier || !vendorName || !vendorAddress || !Number.isFinite(compensation) || compensation <= 0) return fail('One or more vendors are no longer ready for filing. Refresh the review and try again.', 409, operation, 'vendor_not_ready');
        const taxId = await decryptValue(String(identifier.encrypted_tax_id), String(identifier.encryption_iv), `subcontractor:${subcontractorId}`);
        const formId = crypto.randomUUID();
        const encrypted = await encryptValue(taxId, `1099-form:${formId}`);
        forms.push({ id: formId, batch_id: batchId, subcontractor_id: subcontractorId, compensation, vendor_name: vendorName,
          vendor_address: vendorAddress, recipient_email: cleanText(sub.data?.email, 254).toLowerCase(), encrypted_tax_id: encrypted.encrypted,
          encryption_iv: encrypted.iv, encryption_key_version: 1, tax_id_last_four: String(identifier.tax_id_last_four) });
      }
      operation = 'batch.create';
      const now = new Date().toISOString();
      const { error: batchError } = await admin.from('vendor_1099_filing_batches').insert({ id: batchId, tax_year: taxYear, created_by: caller.id, updated_by: caller.id, created_at: now, updated_at: now });
      if (batchError) return fail('Unable to create the filing batch.', 500, operation, batchError.code);
      const { error: formsError } = await admin.from('vendor_1099_forms').insert(forms);
      if (formsError) {
        await admin.from('vendor_1099_filing_batches').delete().eq('id', batchId);
        return fail('Unable to snapshot the vendor forms.', 500, operation, formsError.code);
      }
      return respond({ batch: { id: batchId, taxYear, status: 'draft', formCount: forms.length, totalCompensation: forms.reduce((sum, form) => sum + form.compensation, 0), createdAt: now } });
    }

    return fail('Unsupported 1099 action.', 400, 'request.validate', 'invalid_action');
  } catch (error) {
    return fail('Unable to manage the 1099 filing workspace.', 500, operation, error instanceof Error ? error.name : 'unexpected_error');
  }
});
