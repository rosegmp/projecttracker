import { readFileSync, writeFileSync } from 'node:fs';

const SAFE_PREFIX = 'project-tracker/';
const SAFE_SUFFIX = '.tar.gz.gpg';

function fail(message) {
  throw new Error(message);
}

function main() {
  const [inventoryPath, deletionPath, summaryPath, keepValue] = process.argv.slice(2);
  const keep = Number(keepValue);
  if (!inventoryPath || !deletionPath || !summaryPath || !Number.isInteger(keep) || keep < 0 || keep > 2) {
    fail('Usage: select-backup-retention.mjs <inventory> <deletion> <summary> <keep:0-2>');
  }
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const versions = [...(inventory.Versions || [])];
  const deleteMarkers = [...(inventory.DeleteMarkers || [])];
  for (const item of [...versions, ...deleteMarkers]) {
    if (
      typeof item?.Key !== 'string'
      || !item.Key.startsWith(SAFE_PREFIX)
      || !item.Key.endsWith(SAFE_SUFFIX)
      || typeof item?.VersionId !== 'string'
      || !item.VersionId
    ) fail('B2 inventory contained an object outside the approved backup prefix or format.');
  }
  versions.sort((left, right) => {
    const timestampOrder = Date.parse(right.LastModified || '') - Date.parse(left.LastModified || '');
    return timestampOrder || String(right.VersionId).localeCompare(String(left.VersionId));
  });
  if (versions.some((item) => !Number.isFinite(Date.parse(item.LastModified || '')))) {
    fail('B2 inventory contained an invalid backup timestamp.');
  }
  const retained = versions.slice(0, keep);
  const deleted = [...versions.slice(keep), ...deleteMarkers];
  writeFileSync(deletionPath, JSON.stringify({
    Objects: deleted.map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
    Quiet: true,
  }));
  writeFileSync(summaryPath, JSON.stringify({
    retainedCopies: retained.length,
    retainedBytes: retained.reduce((total, item) => total + (Number(item.Size) || 0), 0),
    deletedVersions: deleted.length,
    deletedBytes: deleted.reduce((total, item) => total + (Number(item.Size) || 0), 0),
  }));
}

try {
  main();
} catch {
  console.error('Backup-retention selection failed. Object names were suppressed.');
  process.exitCode = 1;
}
