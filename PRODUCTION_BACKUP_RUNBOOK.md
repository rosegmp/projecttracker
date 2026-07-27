# Production backup activation runbook

This runbook activates milestone 3.2 only after the Backblaze B2 bucket exists. It never stores credentials or backup contents in Git, GitHub artifacts, job summaries, or logs.

## Approved destination

- Bucket: `dph-recovery-2458`
- S3 endpoint: `https://s3.us-east-005.backblazeb2.com`
- Region: `us-east-005`
- Access: private
- Object Lock: enabled
- Initial retention: 30 days, governance mode applied to every uploaded recovery point

The automation key must be restricted to this bucket. Do not use the B2 master application key. The key must be able to list, read, and write files and read/write file-retention settings. It should not have `bypassGovernance`.

## GitHub environment and secrets

Create a GitHub Actions environment named `production-backup`. Do not add a required reviewer because scheduled workflows cannot wait for daily manual approval.

Add these environment secrets:

| Secret | Value |
| --- | --- |
| `PRODUCTION_SUPABASE_URL` | Exact production project URL |
| `PRODUCTION_SUPABASE_DB_URL` | Production Session pooler database URL with its password |
| `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` | Production service-role key used only to read both private Storage buckets |
| `B2_KEY_ID` | Restricted B2 application Key ID |
| `B2_APPLICATION_KEY` | Restricted B2 application key |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Independently generated secret of at least 32 characters |

Keep the encryption passphrase in an owner-controlled password manager outside GitHub as well. Losing it makes every encrypted recovery point unusable. Do not reuse a Supabase, GitHub, Netlify, B2, or personal account password.

The workflow rejects a Supabase URL or database URL that does not contain the approved production project reference. It also rejects a different B2 bucket, endpoint, or region.

## First manual run

1. Leave the repository variable `PRODUCTION_BACKUPS_ENABLED` unset.
2. Open **Actions → Production recovery backup → Run workflow**.
3. Confirm the run reports:
   - logical database exports completed;
   - two Storage buckets exported;
   - encrypted upload completed;
   - downloaded B2 checksum matched;
   - Object Lock mode is `GOVERNANCE`.
4. In B2 **Browse Files**, verify one new `.tar.gz.gpg` object beneath `project-tracker/YYYY/MM/DD/`.
5. Inspect the object's details and confirm a retention date approximately 30 days in the future.

Do not download or decrypt the object on an unmanaged device.

## Daily activation

After the first manual run passes, create the repository variable:

`PRODUCTION_BACKUPS_ENABLED=true`

The scheduled job runs daily at 07:17 UTC. A skipped scheduled run means the variable is absent or not exactly `true`. A failed run must be treated as a missed recovery point and investigated without placing SQL, object names, credentials, or provider response bodies in an issue.

Do not configure lifecycle deletion until at least two scheduled recovery points and the isolated restore drill have passed. Object Lock protects each uploaded recovery point for 30 days; later retention cleanup must never delete the newest verified copy.

## Activation evidence

- First verified recovery point: GitHub Actions run `30300685312`, 2026-07-27
- Result: five logical dumps, two Storage buckets, 96 aggregate objects
- Encrypted B2 object size: 317,835,231 bytes
- Verification: downloaded SHA-256 matched; Object Lock mode `GOVERNANCE`; retention 30 days
- Daily schedule: enabled with `PRODUCTION_BACKUPS_ENABLED=true`

The two preceding configuration attempts failed before a recovery point was created: run `30300098932` rejected a missing database URL, and run `30300422870` rejected invalid pooler authentication. This is expected fail-closed behavior.
