#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_B2_BUCKET="dph-recovery-2458"
EXPECTED_B2_ENDPOINT="https://s3.us-east-005.backblazeb2.com"
EXPECTED_B2_REGION="us-east-005"
BACKUP_PREFIX="project-tracker/"
KEEP_BACKUPS="${1:-2}"
BYPASS_GOVERNANCE="${2:-false}"

fail() {
  echo "::error::$1"
  exit 1
}

[ "${B2_BUCKET:-}" = "$EXPECTED_B2_BUCKET" ] || fail "Unexpected B2 bucket"
[ "${B2_ENDPOINT:-}" = "$EXPECTED_B2_ENDPOINT" ] || fail "Unexpected B2 endpoint"
[ "${B2_REGION:-}" = "$EXPECTED_B2_REGION" ] || fail "Unexpected B2 region"
[[ "$KEEP_BACKUPS" =~ ^[0-2]$ ]] || fail "Backup retention must be between zero and two copies"
[ "$BYPASS_GOVERNANCE" = "true" ] || [ "$BYPASS_GOVERNANCE" = "false" ] \
  || fail "Invalid governance-bypass setting"
for name in B2_KEY_ID B2_APPLICATION_KEY; do
  [ -n "${!name:-}" ] || fail "${name} is not configured"
done
for command in aws node; do
  command -v "$command" >/dev/null 2>&1 || fail "Required tool ${command} is unavailable"
done

working_root="$(mktemp -d)"
[[ "$working_root" == /tmp/tmp.* ]] || fail "Temporary backup-maintenance directory is unsafe"
trap 'rm -rf -- "$working_root"' EXIT
inventory="$working_root/inventory.json"
deletion="$working_root/deletion.json"
summary="$working_root/summary.json"
delete_result="$working_root/delete-result.json"

AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
AWS_DEFAULT_REGION="$B2_REGION" \
aws s3api list-object-versions \
  --bucket "$B2_BUCKET" \
  --prefix "$BACKUP_PREFIX" \
  --endpoint-url "$B2_ENDPOINT" \
  --output json > "$inventory"

node scripts/select-backup-retention.mjs "$inventory" "$deletion" "$summary" "$KEEP_BACKUPS"
delete_count="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).Objects.length" "$deletion")"
[ "$delete_count" -le 1000 ] || fail "Too many backup versions for one bounded cleanup run"
if [ "$delete_count" -gt 0 ]; then
  bypass_arguments=()
  if [ "$BYPASS_GOVERNANCE" = "true" ]; then
    bypass_arguments+=(--bypass-governance-retention)
  fi
  AWS_ACCESS_KEY_ID="$B2_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY" \
  AWS_DEFAULT_REGION="$B2_REGION" \
  aws s3api delete-objects \
    --bucket "$B2_BUCKET" \
    --delete "file://$deletion" \
    --endpoint-url "$B2_ENDPOINT" \
    "${bypass_arguments[@]}" \
    --output json > "$delete_result"
  delete_errors="$(node -p "(JSON.parse(require('fs').readFileSync(process.argv[1])).Errors || []).length" "$delete_result")"
  [ "$delete_errors" -eq 0 ] || fail "B2 rejected one or more approved backup deletions"
fi

retained_count="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).retainedCopies" "$summary")"
deleted_bytes="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).deletedBytes" "$summary")"
echo "Backup retention complete: retained_copies=${retained_count}, deleted_versions=${delete_count}, deleted_bytes=${deleted_bytes}."
