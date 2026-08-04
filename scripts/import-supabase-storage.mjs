import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BUCKETS = ['project-files', 'takeoff-files', 'certificate-files'];

function fail(message) {
  throw new Error(message);
}

function requireEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`${name} is not configured.`);
  return value;
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

async function filesBelow(root, relative = '') {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail('Storage backup contains a symbolic link.');
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (entry.isFile()) files.push(child);
    else fail('Storage backup contains an unsupported entry.');
  }
  return files;
}

async function request(url, key, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...options.headers,
    },
  });
}

async function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const [storageRootArgument, manifestArgument, outputArgument] = process.argv.slice(2);
  if (!storageRootArgument || !manifestArgument || !outputArgument) {
    fail('Usage: import-supabase-storage.mjs <storage-root> <manifest> <summary-output>');
  }
  const url = requireEnvironment('RECOVERY_SUPABASE_URL').replace(/\/+$/, '');
  const key = requireEnvironment('RECOVERY_SUPABASE_SERVICE_ROLE_KEY');
  const root = path.resolve(storageRootArgument);
  const manifest = JSON.parse(await readFile(manifestArgument, 'utf8'));
  const expected = new Map(manifest.storage.buckets.map((bucket) => [bucket.bucket, bucket]));
  let objectCount = 0;
  let bytes = 0;

  for (const bucket of BUCKETS) {
    const bucketRoot = path.join(root, bucket);
    const files = await filesBelow(bucketRoot);
    const expectedBucket = expected.get(bucket);
    if (!expectedBucket || files.length !== expectedBucket.objectCount) {
      fail('Storage object count does not match the encrypted manifest.');
    }
    let representative = null;
    for (const relative of files) {
      const filePath = path.join(bucketRoot, ...relative.split('/'));
      const body = await readFile(filePath);
      const response = await request(
        `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(relative)}`,
        key,
        {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'true' },
          body,
        },
      );
      if (!response.ok) fail(`Storage upload failed for ${bucket} (HTTP ${response.status}).`);
      objectCount += 1;
      bytes += body.length;
      representative ||= { relative, body };
    }
    if (representative) {
      const response = await request(
        `${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodePath(representative.relative)}`,
        key,
      );
      if (!response.ok) fail(`Representative download failed for ${bucket}.`);
      const downloaded = Buffer.from(await response.arrayBuffer());
      if (await digest(downloaded) !== await digest(representative.body)) {
        fail(`Representative download checksum failed for ${bucket}.`);
      }
    }
  }
  if (objectCount !== manifest.storage.buckets.reduce((sum, bucket) => sum + bucket.objectCount, 0)) {
    fail('Restored Storage aggregate count is invalid.');
  }
  await writeFile(outputArgument, `${JSON.stringify({ objectCount, bytes })}\n`, { flag: 'wx' });
  console.log(`Storage restore verified: ${BUCKETS.length} buckets, ${objectCount} objects.`);
}

main().catch(() => {
  console.error('Storage restore failed. Object names and response bodies were suppressed.');
  process.exitCode = 1;
});
