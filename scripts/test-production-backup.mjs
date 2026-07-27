import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function runNode(script, argumentsList, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argumentsList], {
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

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => {
    if (error) reject(error);
    else resolve();
  }));
}

test('Storage export recursively downloads both approved buckets without logging object names', async () => {
  const secret = 'test-service-role-secret';
  const projectFile = Buffer.from('project bytes');
  const takeoffFile = Buffer.from('takeoff bytes');
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.apikey, secret);
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    const url = new URL(request.url, 'http://127.0.0.1');

    if (request.method === 'POST' && url.pathname.startsWith('/storage/v1/object/list/')) {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { prefix } = JSON.parse(body);
      response.setHeader('content-type', 'application/json');
      if (url.pathname.endsWith('/project-files') && prefix === '') {
        response.end(JSON.stringify([{ name: 'projects', id: null, metadata: null }]));
        return;
      }
      if (url.pathname.endsWith('/project-files') && prefix === 'projects') {
        response.end(JSON.stringify([{ name: 'private-document.pdf', id: '1', metadata: {} }]));
        return;
      }
      if (url.pathname.endsWith('/takeoff-files') && prefix === '') {
        response.end(JSON.stringify([{ name: 'takeoff.pdf', id: '2', metadata: {} }]));
        return;
      }
    }

    if (
      request.method === 'GET'
      && url.pathname.endsWith('/project-files/projects/private-document.pdf')
    ) {
      response.setHeader('content-length', projectFile.length);
      response.end(projectFile);
      return;
    }
    if (request.method === 'GET' && url.pathname.endsWith('/takeoff-files/takeoff.pdf')) {
      response.setHeader('content-length', takeoffFile.length);
      response.end(takeoffFile);
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-backup-test-'));
  try {
    const port = await listen(server);
    const outputRoot = path.join(temporaryRoot, 'storage');
    const summaryPath = path.join(temporaryRoot, 'summary.json');
    const result = await runNode(
      'scripts/export-supabase-storage.mjs',
      [outputRoot, summaryPath],
      {
        PRODUCTION_SUPABASE_URL: `http://127.0.0.1:${port}`,
        PRODUCTION_SUPABASE_SERVICE_ROLE_KEY: secret,
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /2 buckets, 2 objects/);
    assert.doesNotMatch(result.stdout + result.stderr, /private-document|takeoff\.pdf|test-service/);
    assert.deepEqual(
      await readFile(path.join(outputRoot, 'project-files', 'projects', 'private-document.pdf')),
      projectFile,
    );
    assert.deepEqual(
      await readFile(path.join(outputRoot, 'takeoff-files', 'takeoff.pdf')),
      takeoffFile,
    );
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    assert.equal(summary.buckets[0].objectCount, 1);
    assert.equal(summary.buckets[1].objectCount, 1);
  } finally {
    await close(server);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('Manifest reports aggregate COPY counts and hashes without row content', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'project-tracker-manifest-test-'));
  try {
    const plainRoot = path.join(temporaryRoot, 'plain');
    const databaseRoot = path.join(plainRoot, 'database');
    await mkdir(databaseRoot, { recursive: true });
    await writeFile(path.join(databaseRoot, 'roles.sql'), '-- roles\n');
    await writeFile(path.join(databaseRoot, 'schema.sql'), '-- schema\n');
    await writeFile(
      path.join(databaseRoot, 'data.sql'),
      'COPY public.example (id, secret) FROM stdin;\n1\tprivate-value\n2\tother-value\n\\.\n',
    );
    await writeFile(path.join(databaseRoot, 'migration-history-schema.sql'), '-- history\n');
    await writeFile(
      path.join(databaseRoot, 'migration-history-data.sql'),
      'COPY supabase_migrations.schema_migrations (version) FROM stdin;\n1\n\\.\n',
    );

    const summaryPath = path.join(temporaryRoot, 'storage-summary.json');
    await writeFile(summaryPath, JSON.stringify({
      buckets: [
        { bucket: 'project-files', objectCount: 1, contentLengthBytes: 12, unknownSizeObjects: 0 },
        { bucket: 'takeoff-files', objectCount: 1, contentLengthBytes: 13, unknownSizeObjects: 0 },
      ],
    }));
    const manifestPath = path.join(plainRoot, 'manifest.json');
    const result = await runNode(
      'scripts/create-backup-manifest.mjs',
      [plainRoot, summaryPath, manifestPath],
      {
        BACKUP_CREATED_AT: '2026-07-27T00:00:00Z',
        SOURCE_PROJECT_REF_SHA256: 'abc123',
        SUPABASE_CLI_VERSION: '2.109.1',
        TAR_VERSION: 'tar-test',
        GPG_VERSION: 'gpg-test',
      },
    );

    assert.equal(result.code, 0, result.stderr);
    const manifestText = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.database.exportedCopySections, 1);
    assert.equal(manifest.database.exportedRows, 2);
    assert.equal(manifest.database.migrationRows, 1);
    assert.doesNotMatch(manifestText, /private-value|other-value/);
    assert.equal(manifest.database.files.length, 5);
    assert.ok(manifest.database.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
