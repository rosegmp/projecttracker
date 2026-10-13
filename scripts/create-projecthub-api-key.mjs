import { createHash, randomBytes } from 'node:crypto';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || '') : fallback;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const clientId = argument('client-id', 'chatgpt-daily-briefing');
const label = argument('label', 'ChatGPT daily executive briefing');
const rateLimit = Number(argument('requests-per-minute', '60'));
const allowedProjects = argument('projects').split(',').map((value) => value.trim()).filter(Boolean);

if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(clientId)) throw new Error('client-id must contain 3-80 safe characters.');
if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 600) throw new Error('requests-per-minute must be between 1 and 600.');
if (allowedProjects.some((value) => value.length > 160)) throw new Error('Project IDs must be 160 characters or fewer.');

const apiKey = `phro_${randomBytes(32).toString('base64url')}`;
const keyHash = createHash('sha256').update(apiKey).digest('hex');
const projectArray = allowedProjects.length
  ? `array[${allowedProjects.map(sqlLiteral).join(', ')}]::text[]`
  : `'{}'::text[]`;

const sql = `insert into private.projecthub_api_clients
  (id, label, key_hash, scopes, allowed_project_ids, enabled, requests_per_minute, revoked_at)
values
  (${sqlLiteral(clientId)}, ${sqlLiteral(label)}, ${sqlLiteral(keyHash)}, array['projecthub.read','mcp.read'], ${projectArray}, true, ${rateLimit}, null)
on conflict (id) do update set
  label = excluded.label,
  key_hash = excluded.key_hash,
  scopes = excluded.scopes,
  allowed_project_ids = excluded.allowed_project_ids,
  enabled = true,
  requests_per_minute = excluded.requests_per_minute,
  revoked_at = null;`;

console.log('Store this API key in your secret manager. It will not be shown again by this script:');
console.log(apiKey);
console.log('\nRun this SQL once as a Supabase database administrator:');
console.log(sql);
