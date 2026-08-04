import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const DATABASE_FILES = [
  'roles.sql',
  'schema.sql',
  'data.sql',
  'migration-history-schema.sql',
  'migration-history-data.sql',
];
const BUCKETS = ['project-files', 'takeoff-files', 'certificate-files'];
const RESERVED_ROLES = new Set([
  'anon',
  'authenticated',
  'authenticator',
  'cli_login_postgres',
  'dashboard_user',
  'pgbouncer',
  'postgres',
  'service_role',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_functions_admin',
  'supabase_read_only_user',
  'supabase_replication_admin',
  'supabase_storage_admin',
]);
const SAFE_COPY_TARGET = /^(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z0-9_$]*)(?:\.(?:"(?:[^"]|"")+"|[a-zA-Z_][a-zA-Z0-9_$]*))?$/;

function fail(message) {
  throw new Error(message);
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function copyTargets(filePath) {
  const targets = new Set();
  const lines = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const match = /^COPY (.+?) \(.+\) FROM stdin;$/.exec(line);
    if (!match) continue;
    const target = match[1];
    if (!SAFE_COPY_TARGET.test(target)) fail('Backup contains an unsafe COPY target.');
    targets.add(target);
  }
  if (!targets.size) fail('Backup data contains no COPY targets.');
  return [...targets].sort();
}

async function assertOnlyExpectedEntries(root) {
  const entries = (await readdir(root)).sort();
  if (entries.join('\n') !== ['database', 'manifest.json', 'storage'].join('\n')) {
    fail('Backup contains unexpected top-level entries.');
  }
}

function sanitizeRoles(source) {
  const kept = [];
  for (const line of source.split('\n')) {
    const roleStatement = /^(?:CREATE|ALTER) ROLE "([^"]+)"(?:\s|;)/.exec(line);
    if (roleStatement && RESERVED_ROLES.has(roleStatement[1])) continue;
    if (/^(?:GRANT|REVOKE)\b/.test(line)) {
      const mentionedRoles = [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      if (mentionedRoles.some((role) => RESERVED_ROLES.has(role))) continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

async function main() {
  const [plainRootArgument, outputRootArgument] = process.argv.slice(2);
  if (!plainRootArgument || !outputRootArgument) {
    fail('Usage: prepare-recovery-restore.mjs <plain-root> <output-root>');
  }
  const plainRoot = path.resolve(plainRootArgument);
  const outputRoot = path.resolve(outputRootArgument);
  const expectedSourceHash = String(process.env.EXPECTED_SOURCE_PROJECT_REF_SHA256 || '');
  if (!/^[a-f0-9]{64}$/.test(expectedSourceHash)) fail('Expected source hash is invalid.');

  await assertOnlyExpectedEntries(plainRoot);
  const manifest = JSON.parse(await readFile(path.join(plainRoot, 'manifest.json'), 'utf8'));
  if (manifest.formatVersion !== 1) fail('Unsupported backup format version.');
  if (manifest.source?.projectRefSha256 !== expectedSourceHash) {
    fail('Backup source does not match the approved production project.');
  }
  if (!Number.isFinite(Date.parse(manifest.createdAt))) fail('Backup timestamp is invalid.');

  const listedFiles = new Map((manifest.database?.files || []).map((file) => [file.name, file]));
  for (const name of DATABASE_FILES) {
    const filePath = path.join(plainRoot, 'database', name);
    const details = await stat(filePath);
    const listed = listedFiles.get(name);
    if (!details.isFile() || details.size !== listed?.bytes || await sha256(filePath) !== listed?.sha256) {
      fail('Database backup integrity verification failed.');
    }
  }

  const bucketSummaries = manifest.storage?.buckets;
  if (!Array.isArray(bucketSummaries) || bucketSummaries.length !== BUCKETS.length) {
    fail('Storage manifest does not contain every approved bucket.');
  }
  for (const bucket of BUCKETS) {
    if (!bucketSummaries.some((entry) => entry.bucket === bucket)) {
      fail('Storage manifest contains an unexpected bucket set.');
    }
    const details = await stat(path.join(plainRoot, 'storage', bucket));
    if (!details.isDirectory()) fail('Storage backup directory is missing.');
  }

  const targets = await copyTargets(path.join(plainRoot, 'database', 'data.sql'));
  const migrationTargets = await copyTargets(
    path.join(plainRoot, 'database', 'migration-history-data.sql'),
  );
  await mkdir(outputRoot, { recursive: true });
  const sanitizedRoles = sanitizeRoles(
    await readFile(path.join(plainRoot, 'database', 'roles.sql'), 'utf8'),
  );
  await writeFile(path.join(outputRoot, 'roles.sql'), sanitizedRoles, { flag: 'wx' });
  await writeFile(
    path.join(outputRoot, 'truncate.sql'),
    `TRUNCATE TABLE ${targets.join(', ')} CASCADE;\n`,
    { flag: 'wx' },
  );
  const countExpression = targets
    .map((target) => `SELECT count(*)::bigint AS row_count FROM ${target}`)
    .join('\nUNION ALL\n');
  await writeFile(
    path.join(outputRoot, 'count.sql'),
    `SELECT coalesce(sum(row_count), 0)::bigint FROM (\n${countExpression}\n) restored;\n`,
    { flag: 'wx' },
  );
  const migrationCountExpression = migrationTargets
    .map((target) => `SELECT count(*)::bigint AS row_count FROM ${target}`)
    .join('\nUNION ALL\n');
  await writeFile(
    path.join(outputRoot, 'migration-count.sql'),
    `SELECT coalesce(sum(row_count), 0)::bigint FROM (\n${migrationCountExpression}\n) restored;\n`,
    { flag: 'wx' },
  );

  const summary = {
    createdAt: manifest.createdAt,
    databaseRows: manifest.database.exportedRows,
    migrationRows: manifest.database.migrationRows,
    storageObjects: bucketSummaries.reduce((sum, bucket) => sum + bucket.objectCount, 0),
    storageBytes: bucketSummaries.reduce((sum, bucket) => sum + bucket.contentLengthBytes, 0),
  };
  if (!Object.values(summary).every((value) => (
    typeof value === 'string' || Number.isSafeInteger(value)
  ))) fail('Backup summary contains invalid aggregate values.');
  await writeFile(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary)}\n`, { flag: 'wx' });
}

main().catch(() => {
  console.error('Recovery-point verification failed. Backup contents were suppressed.');
  process.exitCode = 1;
});
