import { fetchAuthorizedSupabase } from './trackerData.js';

const SUPABASE_URL = (import.meta.env?.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = (import.meta.env?.VITE_SUPABASE_KEY || '').trim();
const TOKEN_STORAGE_KEY = 'project-tracker:digital-approval-token';

async function readResponse(response, fallback) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error || text || fallback);
  return payload;
}

function publicFunctionRequest(body) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Project Hub approval service is not configured.');
  return fetch(`${SUPABASE_URL}/functions/v1/manage-digital-approval`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function consumeDigitalApprovalToken() {
  if (typeof window === 'undefined') return '';
  const match = window.location.hash.match(/^#approval=([A-Za-z0-9_-]{40,160})$/);
  if (match) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, match[1]);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    return match[1];
  }
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function clearDigitalApprovalToken() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export async function createDigitalApprovalRequest({ sourceType, sourceId, sourceVersion, expiresInDays = 14 }) {
  const response = await fetchAuthorizedSupabase('/functions/v1/manage-digital-approval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', sourceType, sourceId, sourceVersion, expiresInDays }),
  }, 'Digital approval request', 45000);
  return readResponse(response, 'Unable to send the secure approval request.');
}

export async function loadDigitalApproval(token) {
  return readResponse(await publicFunctionRequest({ action: 'load', token }), 'Unable to load this approval request.');
}

export async function respondToDigitalApproval(token, { decision, signerName, signerEmail, comment }) {
  return readResponse(await publicFunctionRequest({
    action: 'respond', token, decision, signerName, signerEmail, comment,
  }), 'Unable to save this approval decision.');
}
