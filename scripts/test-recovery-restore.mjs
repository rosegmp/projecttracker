import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const buckets = ['project-files', 'takeoff-files', 'certificate-files'];

function runNode(script, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

test('recovery preparation verifies hashes and creates bounded aggregate SQL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-recovery-'));
  try {
    const plain = path.join(root, 'plain');
    const database = path.join(plain, 'database');
    const storage = path.join(plain, 'storage');
    const generated = path.join(root, 'generated');
    await mkdir(database, { recursive: true });
    for (const bucket of buckets) await mkdir(path.join(storage, bucket), { recursive: true });
    const sql = new Map([
      ['roles.sql', 'ALTER ROLE "supabase_admin" WITH LOGIN;\nCREATE ROLE "custom_reader";\nALTER ROLE "custom_reader" WITH NOLOGIN;\nGRANT "custom_reader" TO "postgres";\n'],
      ['schema.sql', '-- schema\n'],
      ['data.sql', 'COPY public.example (id) FROM stdin;\n1\n\\.\nCOPY auth.users (id) FROM stdin;\n2\n\\.\n'],
      ['migration-history-schema.sql', '-- history schema\n'],
      ['migration-history-data.sql', 'COPY supabase_migrations.schema_migrations (version) FROM stdin;\n1\n\\.\n'],
    ]);
    for (const [name, value] of sql) await writeFile(path.join(database, name), value);
    const sourceHash = hash('approved-production');
    await writeFile(path.join(plain, 'manifest.json'), JSON.stringify({
      formatVersion: 1,
      createdAt: '2026-08-03T07:17:00Z',
      source: { projectRefSha256: sourceHash },
      database: {
        files: [...sql].map(([name, value]) => ({
          name,
          bytes: Buffer.byteLength(value),
          sha256: hash(value),
        })),
        exportedRows: 2,
        migrationRows: 1,
      },
      storage: {
        buckets: buckets.map((bucket) => ({
          bucket,
          objectCount: 0,
          contentLengthBytes: 0,
          unknownSizeObjects: 0,
        })),
      },
    }));

    const result = await runNode(
      'scripts/prepare-recovery-restore.mjs',
      [plain, generated],
      { EXPECTED_SOURCE_PROJECT_REF_SHA256: sourceHash },
    );
    assert.equal(result.code, 0, result.stderr);
    const truncate = await readFile(path.join(generated, 'truncate.sql'), 'utf8');
    assert.equal(truncate, 'TRUNCATE TABLE auth.users, public.example CASCADE;\n');
    const roles = await readFile(path.join(generated, 'roles.sql'), 'utf8');
    assert.doesNotMatch(roles, /ALTER ROLE "supabase_admin"|GRANT "custom_reader" TO "postgres"/);
    assert.match(roles, /CREATE ROLE "custom_reader"/);
    assert.match(roles, /ALTER ROLE "custom_reader"/);
    assert.doesNotMatch(result.stdout + result.stderr, /auth\.users|public\.example/);
    const summary = JSON.parse(await readFile(path.join(generated, 'summary.json'), 'utf8'));
    assert.equal(summary.databaseRows, 2);

    const rejected = await runNode(
      'scripts/prepare-recovery-restore.mjs',
      [plain, path.join(root, 'rejected')],
      { EXPECTED_SOURCE_PROJECT_REF_SHA256: '0'.repeat(64) },
    );
    assert.notEqual(rejected.code, 0);
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /approved-production|auth\.users/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('storage import uploads and verifies one representative without logging names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-storage-restore-'));
  const secret = 'recovery-service-role-secret';
  const uploaded = new Map();
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.apikey, secret);
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'POST' && url.pathname.startsWith('/storage/v1/object/')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      uploaded.set(url.pathname, Buffer.concat(chunks));
      response.statusCode = 200;
      response.end('{}');
      return;
    }
    if (request.method === 'GET' && url.pathname.includes('/storage/v1/object/authenticated/')) {
      const uploadPath = url.pathname.replace('/object/authenticated/', '/object/');
      const value = uploaded.get(uploadPath);
      if (value) {
        response.statusCode = 200;
        response.end(value);
        return;
      }
    }
    response.statusCode = 404;
    response.end();
  });
  try {
    const storage = path.join(root, 'storage');
    const manifestPath = path.join(root, 'manifest.json');
    const outputPath = path.join(root, 'result.json');
    for (const [index, bucket] of buckets.entries()) {
      await mkdir(path.join(storage, bucket, 'private'), { recursive: true });
      await writeFile(path.join(storage, bucket, 'private', `secret-${index}.pdf`), `bytes-${index}`);
    }
    await writeFile(manifestPath, JSON.stringify({
      storage: {
        buckets: buckets.map((bucket) => ({ bucket, objectCount: 1, contentLengthBytes: 7 })),
      },
    }));
    const port = await listen(server);
    const result = await runNode(
      'scripts/import-supabase-storage.mjs',
      [storage, manifestPath, outputPath],
      {
        RECOVERY_SUPABASE_URL: `http://127.0.0.1:${port}`,
        RECOVERY_SUPABASE_SERVICE_ROLE_KEY: secret,
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /3 buckets, 3 objects/);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-0|recovery-service-role/);
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).objectCount, 3);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('storage import reports only controlled HTTP failure details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-storage-failure-'));
  const server = createServer((request, response) => {
    response.statusCode = 413;
    response.end('private provider response');
  });
  try {
    const storage = path.join(root, 'storage');
    const manifestPath = path.join(root, 'manifest.json');
    for (const bucket of buckets) await mkdir(path.join(storage, bucket), { recursive: true });
    await writeFile(path.join(storage, 'project-files', 'confidential-name.pdf'), 'bytes');
    await writeFile(manifestPath, JSON.stringify({
      storage: {
        buckets: buckets.map((bucket, index) => ({
          bucket,
          objectCount: index === 0 ? 1 : 0,
          contentLengthBytes: index === 0 ? 5 : 0,
        })),
      },
    }));
    const port = await listen(server);
    const result = await runNode(
      'scripts/import-supabase-storage.mjs',
      [storage, manifestPath, path.join(root, 'result.json')],
      {
        RECOVERY_SUPABASE_URL: `http://127.0.0.1:${port}`,
        RECOVERY_SUPABASE_SERVICE_ROLE_KEY: 'failure-secret',
      },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /project-files \(HTTP 413\)/);
    assert.doesNotMatch(result.stdout + result.stderr, /confidential-name|private provider|failure-secret/);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});
