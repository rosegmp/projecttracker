#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PRODUCTION_PROJECT_REF="oxojlwhmarafxuqvqgqg"
EXPECTED_RECOVERY_PROJECT_REF="kvvvzthzdvzfovphrnlq"
EXPECTED_RECOVERY_URL="https://${EXPECTED_RECOVERY_PROJECT_REF}.supabase.co"
EXPECTED_B2_BUCKET="dph-recovery-2458"
EXPECTED_B2_ENDPOINT="https://s3.us-east-005.backblazeb2.com"
EXPECTED_B2_REGION="us-east-005"

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

for name in RECOVERY_SUPABASE_PROJECT_REF RECOVERY_SUPABASE_URL RECOVERY_SUPABASE_DB_URL \
  RECOVERY_SUPABASE_SERVICE_ROLE_KEY B2_KEY_ID B2_APPLICATION_KEY BACKUP_ENCRYPTION_PASSPHRASE
do
  require_environment "$name"
done

[ "${RECOVERY_CONFIRMATION:-}" = "OVERWRITE_PROJECT_HUB_STAGING" ] \
  || fail "Exact recovery confirmation was not supplied"
[ "$RECOVERY_SUPABASE_PROJECT_REF" = "$EXPECTED_RECOVERY_PROJECT_REF" ] \
  || fail "Recovery project ref is not the approved staging target"
[ "$RECOVERY_SUPABASE_URL" = "$EXPECTED_RECOVERY_URL" ] \
  || fail "Recovery URL is not the approved staging target"
[[ "$RECOVERY_SUPABASE_DB_URL" == *"postgres.${EXPECTED_RECOVERY_PROJECT_REF}"* ]] \
  || fail "Recovery database URL does not identify the approved staging target"
[[ "$RECOVERY_SUPABASE_DB_URL" != *"$PRODUCTION_PROJECT_REF"* ]] \
  || fail "Refusing to restore into production"
[ "${B2_BUCKET:-}" = "$EXPECTED_B2_BUCKET" ] || fail "Unexpected B2 bucket"
[ "${B2_ENDPOINT:-}" = "$EXPECTED_B2_ENDPOINT" ] || fail "Unexpected B2 endpoint"
[ "${B2_REGION:-}" = "$EXPECTED_B2_REGION" ] || fail "Unexpected B2 region"
[ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -ge 32 ] || fail "Invalid encryption passphrase"

for command in aws gpg node psql sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || fail "Required tool ${command} is unavailable"
done

restore_started_epoch="$(date -u +%s)"
restore_root="$(mktemp -d)"
cleanup() {
  if [ -n "${restore_root:-}" ] && [ -d "$restore_root" ]; then
    find "$restore_root" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf -- "$restore_root"
  fi
}
trap cleanup EXIT

encrypted_archive="$restore_root/recovery.tar.gz.gpg"
archive="$restore_root/recovery.tar.gz"
plain_root="$restore_root/plain"
generated_root="$restore_root/generated"
mkdir -p "$plain_root" "$generated_root"

echo "Selecting the newest encrypted production recovery point."
object_key="$(
  AWS_ACCESS_KEY_ID="$B2_KEY_ID" AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  AWS_DEFAULT_REGION="$B2_REGION" aws s3api list-objects-v2 \
    --bucket "$B2_BUCKET" --prefix project-tracker/ --endpoint-url "$B2_ENDPOINT" \
    --query 'sort_by(Contents,&LastModified)[-1].Key' --output text
)"
[[ "$object_key" =~ ^project-tracker/[0-9]{4}/[0-9]{2}/[0-9]{2}/[0-9TZ-]+\.tar\.gz\.gpg$ ]] \
  || fail "No valid production recovery point was found"

expected_sha="$(
  AWS_ACCESS_KEY_ID="$B2_KEY_ID" AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  AWS_DEFAULT_REGION="$B2_REGION" aws s3api head-object \
    --bucket "$B2_BUCKET" --key "$object_key" --endpoint-url "$B2_ENDPOINT" \
    --query 'Metadata.sha256' --output text
)"
[[ "$expected_sha" =~ ^[a-f0-9]{64}$ ]] || fail "Recovery point checksum metadata is invalid"
retention_mode="$(
  AWS_ACCESS_KEY_ID="$B2_KEY_ID" AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  AWS_DEFAULT_REGION="$B2_REGION" aws s3api get-object-retention \
    --bucket "$B2_BUCKET" --key "$object_key" --endpoint-url "$B2_ENDPOINT" \
    --query 'Retention.Mode' --output text
)"
[ "$retention_mode" = "GOVERNANCE" ] || fail "Recovery point is not Governance locked"

AWS_ACCESS_KEY_ID="$B2_KEY_ID" AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
AWS_DEFAULT_REGION="$B2_REGION" aws s3api get-object \
  --bucket "$B2_BUCKET" --key "$object_key" --endpoint-url "$B2_ENDPOINT" \
  "$encrypted_archive" >/dev/null
[ "$(sha256sum "$encrypted_archive" | cut -d' ' -f1)" = "$expected_sha" ] \
  || fail "Downloaded recovery point checksum mismatch"

printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --decrypt --output "$archive" "$encrypted_archive" 2>/dev/null
shred -u "$encrypted_archive"
tar --extract --gzip --file "$archive" --directory "$plain_root" \
  --no-same-owner --no-same-permissions
shred -u "$archive"

export EXPECTED_SOURCE_PROJECT_REF_SHA256
EXPECTED_SOURCE_PROJECT_REF_SHA256="$(printf '%s' "$PRODUCTION_PROJECT_REF" | sha256sum | cut -d' ' -f1)"
node scripts/prepare-recovery-restore.mjs "$plain_root" "$generated_root"

summary="$generated_root/summary.json"
backup_created_at="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).createdAt" "$summary")"
expected_database_rows="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).databaseRows" "$summary")"
expected_migration_rows="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).migrationRows" "$summary")"
expected_storage_objects="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).storageObjects" "$summary")"

echo "Verifying the approved recovery database connection."
psql "$RECOVERY_SUPABASE_DB_URL" --no-psqlrc --tuples-only --no-align \
  --variable ON_ERROR_STOP=1 --command 'SELECT 1' >/dev/null

echo "Clearing the approved staging target and restoring database/Auth data."
psql "$RECOVERY_SUPABASE_DB_URL" --no-psqlrc --variable ON_ERROR_STOP=1 \
  --command 'SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role; GRANT ALL ON SCHEMA public TO postgres, service_role; DROP SCHEMA IF EXISTS supabase_migrations CASCADE;' \
  >/dev/null
psql "$RECOVERY_SUPABASE_DB_URL" --no-psqlrc --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$generated_root/roles.sql" \
  --file "$plain_root/database/schema.sql" \
  --file "$generated_root/truncate.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$plain_root/database/data.sql" \
  >/dev/null
psql "$RECOVERY_SUPABASE_DB_URL" --no-psqlrc --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$plain_root/database/migration-history-schema.sql" \
  --file "$plain_root/database/migration-history-data.sql" \
  >/dev/null

restored_database_rows="$(psql "$RECOVERY_SUPABASE_DB_URL" --no-psqlrc --tuples-only --no-align --variable ON_ERROR_STOP=1 --file "$generated_root/count.sql")"
restored_migration_rows="$(psql "$RECOVERY_SUPABASE_DB_URL" --no-psqlrc --tuples-only --no-align --variable ON_ERROR_STOP=1 --file "$generated_root/migration-count.sql")"
[ "$restored_database_rows" = "$expected_database_rows" ] || fail "Restored database row aggregate does not match"
[ "$restored_migration_rows" = "$expected_migration_rows" ] || fail "Restored migration history aggregate does not match"

echo "Restoring and verifying private Storage objects."
storage_result="$generated_root/storage-result.json"
node scripts/import-supabase-storage.mjs "$plain_root/storage" "$plain_root/manifest.json" "$storage_result"
restored_storage_objects="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).objectCount" "$storage_result")"
[ "$restored_storage_objects" = "$expected_storage_objects" ] || fail "Restored Storage aggregate does not match"

restore_completed_epoch="$(date -u +%s)"
rto_seconds="$((restore_completed_epoch - restore_started_epoch))"
rpo_seconds="$((restore_started_epoch - $(date -u -d "$backup_created_at" +%s)))"
echo "Recovery restore verified: database_rows=${restored_database_rows}, storage_objects=${restored_storage_objects}, rpo_seconds=${rpo_seconds}, restore_seconds=${rto_seconds}."

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "backup_created_at=$backup_created_at"
    echo "database_rows=$restored_database_rows"
    echo "storage_objects=$restored_storage_objects"
    echo "rpo_seconds=$rpo_seconds"
    echo "restore_seconds=$rto_seconds"
  } >> "$GITHUB_OUTPUT"
fi
