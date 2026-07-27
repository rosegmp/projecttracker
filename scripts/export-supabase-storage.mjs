import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const STORAGE_BUCKETS = ['project-files', 'takeoff-files'];
const PAGE_SIZE = 1000;

function fail(message) {
  throw new Error(message);
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Required environment variable ${name} is missing.`);
  return value;
}

function encodeObjectPath(objectPath) {
  return objectPath.split('/').map(encodeURIComponent).join('/');
}

function safeDestination(root, objectPath) {
  const segments = objectPath.split('/');
  if (
    !objectPath
    || objectPath.startsWith('/')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    fail('Storage returned an unsafe object path.');
  }

  const destination = path.resolve(root, ...segments);
  const relative = path.relative(path.resolve(root), destination);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('Storage returned an object path outside the backup directory.');
  }
  return destination;
}

async function storageRequest(url, serviceRoleKey, options = {}) {
  const headers = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    ...options.headers,
  };
  if (options.body != null) headers['content-type'] = 'application/json';

  const response = await fetch(url, {
    ...options,
    headers,
  });

  return response;
}

async function listDirectory(supabaseUrl, serviceRoleKey, bucket, prefix) {
  const objects = [];
  let offset = 0;

  for (;;) {
    const response = await storageRequest(
      `${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
      serviceRoleKey,
      {
        method: 'POST',
        body: JSON.stringify({
          prefix,
          limit: PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        }),
      },
    );

    if (!response.ok) {
      fail(`Unable to list ${bucket} objects (HTTP ${response.status}).`);
    }

    const page = await response.json();
    if (!Array.isArray(page)) fail(`Unexpected ${bucket} listing response.`);

    for (const entry of page) {
      if (!entry || typeof entry.name !== 'string' || !entry.name) {
        fail(`Unexpected ${bucket} listing entry.`);
      }
      const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id == null && entry.metadata == null) {
        objects.push(...await listDirectory(supabaseUrl, serviceRoleKey, bucket, objectPath));
      } else {
        objects.push(objectPath);
      }
    }

    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }

  return objects;
}

async function downloadObject(supabaseUrl, serviceRoleKey, bucket, objectPath, bucketRoot) {
  const response = await storageRequest(
    `${supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
    serviceRoleKey,
    { method: 'GET' },
  );

  if (!response.ok || !response.body) {
    fail(`Unable to download an object from ${bucket} (HTTP ${response.status}).`);
  }

  const destination = safeDestination(bucketRoot, objectPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx' }));

  const contentLength = Number(response.headers.get('content-length'));
  return Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null;
}

async function exportBucket(supabaseUrl, serviceRoleKey, bucket, outputRoot) {
  const bucketRoot = path.join(outputRoot, bucket);
  await mkdir(bucketRoot, { recursive: true });
  const objects = await listDirectory(supabaseUrl, serviceRoleKey, bucket, '');

  let bytes = 0;
  let unknownSizeObjects = 0;
  for (const objectPath of objects) {
    const contentLength = await downloadObject(
      supabaseUrl,
      serviceRoleKey,
      bucket,
      objectPath,
      bucketRoot,
    );
    if (contentLength == null) unknownSizeObjects += 1;
    else bytes += contentLength;
  }

  return {
    bucket,
    objectCount: objects.length,
    contentLengthBytes: bytes,
    unknownSizeObjects,
  };
}

async function main() {
  const [outputRootArgument, summaryPathArgument] = process.argv.slice(2);
  if (!outputRootArgument || !summaryPathArgument) {
    fail('Usage: export-supabase-storage.mjs <output-root> <summary-json>');
  }

  const supabaseUrl = requireEnvironment('PRODUCTION_SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = requireEnvironment('PRODUCTION_SUPABASE_SERVICE_ROLE_KEY');
  const outputRoot = path.resolve(outputRootArgument);
  const summaryPath = path.resolve(summaryPathArgument);
  await mkdir(outputRoot, { recursive: true });

  const buckets = [];
  for (const bucket of STORAGE_BUCKETS) {
    buckets.push(await exportBucket(supabaseUrl, serviceRoleKey, bucket, outputRoot));
  }

  await writeFile(summaryPath, `${JSON.stringify({ buckets }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  const objectCount = buckets.reduce((total, bucket) => total + bucket.objectCount, 0);
  console.log(`Storage export completed: ${STORAGE_BUCKETS.length} buckets, ${objectCount} objects.`);
}

main().catch(() => {
  console.error('Storage export failed. Object names and response bodies were suppressed.');
  process.exitCode = 1;
});
