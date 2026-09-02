#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_PROJECT_REF="oxojlwhmarafxuqvqgqg"
EXPECTED_SUPABASE_URL="https://${EXPECTED_PROJECT_REF}.supabase.co"
EXPECTED_B2_BUCKET="dph-recovery-2458"
EXPECTED_B2_ENDPOINT="https://s3.us-east-005.backblazeb2.com"
EXPECTED_B2_REGION="us-east-005"
RETENTION_DAYS=1

fail() {
  echo "::error::$1"
  exit 1
}

require_environment() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "${name} is not configured"
  case "${!name}" in
    *$'\n'*|*$'\r'*) fail "${name} contains an invalid newline" ;;
  esac
}

for name in \
  PRODUCTION_SUPABASE_URL \
  PRODUCTION_SUPABASE_DB_URL \
  PRODUCTION_SUPABASE_SERVICE_ROLE_KEY \
  B2_KEY_ID \
  B2_APPLICATION_KEY \
  BACKUP_ENCRYPTION_PASSPHRASE
do
  require_environment "$name"
done

[ "$PRODUCTION_SUPABASE_URL" = "$EXPECTED_SUPABASE_URL" ] \
  || fail "PRODUCTION_SUPABASE_URL does not identify the approved production project"
[[ "$PRODUCTION_SUPABASE_DB_URL" == *"$EXPECTED_PROJECT_REF"* ]] \
  || fail "PRODUCTION_SUPABASE_DB_URL does not identify the approved production project"
[ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -ge 32 ] \
  || fail "BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters"
[ "${B2_BUCKET:-}" = "$EXPECTED_B2_BUCKET" ] || fail "Unexpected B2 bucket"
[ "${B2_ENDPOINT:-}" = "$EXPECTED_B2_ENDPOINT" ] || fail "Unexpected B2 endpoint"
[ "${B2_REGION:-}" = "$EXPECTED_B2_REGION" ] || fail "Unexpected B2 region"
[ "${CLEAR_EXISTING_BACKUPS:-false}" = "true" ] || [ "${CLEAR_EXISTING_BACKUPS:-false}" = "false" ] \
  || fail "Invalid existing-backup cleanup setting"

for command in supabase node tar gpg aws sha256sum; do
  command -v "$command" >/dev/null 2>&1 || fail "Required tool ${command} is unavailable"
done

backup_root="$(mktemp -d)"
cleanup() {
  if [ -n "${backup_root:-}" ] && [ -d "$backup_root" ]; then
    find "$backup_root" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf -- "$backup_root"
  fi
}
trap cleanup EXIT

plain_root="$backup_root/plain"
database_root="$plain_root/database"
storage_root="$plain_root/storage"
mkdir -p "$database_root" "$storage_root"

created_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
retain_until="$(date -u -d "+${RETENTION_DAYS} days" +'%Y-%m-%dT%H:%M:%SZ')"
object_key="project-tracker/$(date -u +'%Y/%m/%d')/${timestamp}-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}.tar.gz.gpg"

echo "Creating logical database exports."
supabase db dump --db-url "$PRODUCTION_SUPABASE_DB_URL" \
  -f "$database_root/roles.sql" --role-only
supabase db dump --db-url "$PRODUCTION_SUPABASE_DB_URL" \
  -f "$database_root/schema.sql"
supabase db dump --db-url "$PRODUCTION_SUPABASE_DB_URL" \
  -f "$database_root/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "$PRODUCTION_SUPABASE_DB_URL" \
  -f "$database_root/migration-history-schema.sql" --schema supabase_migrations
supabase db dump --db-url "$PRODUCTION_SUPABASE_DB_URL" \
  -f "$database_root/migration-history-data.sql" --use-copy --data-only \
  --schema supabase_migrations

echo "Exporting private Storage buckets."
storage_summary="$backup_root/storage-summary.json"
node scripts/export-supabase-storage.mjs "$storage_root" "$storage_summary"

export BACKUP_CREATED_AT="$created_at"
export SOURCE_PROJECT_REF_SHA256
SOURCE_PROJECT_REF_SHA256="$(printf '%s' "$EXPECTED_PROJECT_REF" | sha256sum | cut -d' ' -f1)"
export SUPABASE_CLI_VERSION
SUPABASE_CLI_VERSION="$(supabase --version | head -n 1)"
export TAR_VERSION
TAR_VERSION="$(tar --version | head -n 1)"
export GPG_VERSION
GPG_VERSION="$(gpg --version | head -n 1)"

manifest="$plain_root/manifest.json"
node scripts/create-backup-manifest.mjs "$plain_root" "$storage_summary" "$manifest"

archive="$backup_root/project-tracker-backup.tar.gz"
encrypted_archive="${archive}.gpg"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -czf "$archive" -C "$plain_root" .

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --symmetric \
  --cipher-algo AES256 \
  --s2k-digest-algo SHA512 \
  --output "$encrypted_archive" \
  "$archive"
shred -u "$archive"

local_sha256="$(sha256sum "$encrypted_archive" | cut -d' ' -f1)"
local_bytes="$(stat -c '%s' "$encrypted_archive")"

if [ "${CLEAR_EXISTING_BACKUPS:-false}" = "true" ]; then
  echo "Clearing legacy Project Tracker recovery points after preparing the replacement archive."
  bash scripts/prune-production-backups.sh 0 true
fi

echo "Uploading encrypted recovery point to B2."
AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
AWS_DEFAULT_REGION="$B2_REGION" \
aws s3api put-object \
  --bucket "$B2_BUCKET" \
  --key "$object_key" \
  --body "$encrypted_archive" \
  --endpoint-url "$B2_ENDPOINT" \
  --object-lock-mode GOVERNANCE \
  --object-lock-retain-until-date "$retain_until" \
  --metadata "sha256=${local_sha256},format-version=1" \
  >/dev/null

verified_archive="$backup_root/verified.tar.gz.gpg"
AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
AWS_DEFAULT_REGION="$B2_REGION" \
aws s3api get-object \
  --bucket "$B2_BUCKET" \
  --key "$object_key" \
  --endpoint-url "$B2_ENDPOINT" \
  "$verified_archive" \
  >/dev/null

verified_sha256="$(sha256sum "$verified_archive" | cut -d' ' -f1)"
[ "$verified_sha256" = "$local_sha256" ] || fail "B2 verification checksum mismatch"

retention_mode="$(
  AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  AWS_DEFAULT_REGION="$B2_REGION" \
  aws s3api get-object-retention \
    --bucket "$B2_BUCKET" \
    --key "$object_key" \
    --endpoint-url "$B2_ENDPOINT" \
    --query 'Retention.Mode' \
    --output text
)"
[ "$retention_mode" = "GOVERNANCE" ] || fail "B2 Object Lock verification failed"

# Each recovery point has a unique key. Retain the newest two verified copies
# and remove older versions only after the new upload and checksum validation.
bash scripts/prune-production-backups.sh 2 false

echo "Backup verified: encrypted_bytes=${local_bytes}, retention_days=${RETENTION_DAYS}."
