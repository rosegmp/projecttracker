import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const SQL_FILES = [
  'roles.sql',
  'schema.sql',
  'data.sql',
  'migration-history-schema.sql',
  'migration-history-data.sql',
];

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function summarizeSqlData(filePath) {
  const lines = readline.createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let copySections = 0;
  let rows = 0;
  let insideCopy = false;
  for await (const line of lines) {
    if (!insideCopy && /^COPY .+ FROM stdin;$/.test(line)) {
      copySections += 1;
      insideCopy = true;
      continue;
    }
    if (insideCopy && line === '\\.') {
      insideCopy = false;
      continue;
    }
    if (insideCopy) rows += 1;
  }
  if (insideCopy) throw new Error('Incomplete COPY section in data export.');
  return { copySections, rows };
}

async function main() {
  const [plainRootArgument, storageSummaryArgument, manifestPathArgument] = process.argv.slice(2);
  if (!plainRootArgument || !storageSummaryArgument || !manifestPathArgument) {
    throw new Error('Usage: create-backup-manifest.mjs <plain-root> <storage-summary> <manifest>');
  }

  const plainRoot = path.resolve(plainRootArgument);
  const storageSummary = JSON.parse(await readFile(storageSummaryArgument, 'utf8'));
  const files = [];
  for (const name of SQL_FILES) {
    const filePath = path.join(plainRoot, 'database', name);
    const details = await stat(filePath);
    if (!details.isFile() || details.size === 0) throw new Error(`Backup output ${name} is empty.`);
    files.push({ name, bytes: details.size, sha256: await sha256(filePath) });
  }

  const dataSummary = await summarizeSqlData(path.join(plainRoot, 'database', 'data.sql'));
  const migrationSummary = await summarizeSqlData(
    path.join(plainRoot, 'database', 'migration-history-data.sql'),
  );

  const manifest = {
    formatVersion: 1,
    createdAt: process.env.BACKUP_CREATED_AT,
    source: {
      provider: 'supabase',
      projectRefSha256: process.env.SOURCE_PROJECT_REF_SHA256,
    },
    workflow: {
      repositoryCommit: process.env.GITHUB_SHA || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    },
    tools: {
      supabase: process.env.SUPABASE_CLI_VERSION,
      node: process.version,
      archive: process.env.TAR_VERSION,
      encryption: process.env.GPG_VERSION,
    },
    database: {
      files,
      exportedCopySections: dataSummary.copySections,
      exportedRows: dataSummary.rows,
      migrationCopySections: migrationSummary.copySections,
      migrationRows: migrationSummary.rows,
    },
    storage: storageSummary,
  };

  await writeFile(manifestPathArgument, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

main().catch(() => {
  console.error('Backup manifest creation failed. Backup contents were suppressed.');
  process.exitCode = 1;
});
