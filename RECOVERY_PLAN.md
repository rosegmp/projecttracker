# Project Tracker Recovery Plan

Status: roadmap #3 milestone 3.1 inventory complete on 2026-07-27. This milestone was read-only; it did not create backups, export production data, change provider settings, rotate credentials, or perform a restore.

## Objective

Make Project Tracker recoverable after accidental deletion, a bad deployment or migration, provider loss, credential loss, or corruption while preserving the application's authorization and privacy boundaries.

This plan distinguishes four measurements:

- **RPO (recovery point objective):** the maximum acceptable age of restored data.
- **RTO (recovery time objective):** the target time to restore usable service.
- **Retention:** how long recovery points remain available.
- **Restore verification:** evidence that a backup is complete and can actually be recovered.

## Recommended recovery targets

These are proposed targets for owner approval. They are not current guarantees.

| Tier | Surface | Proposed RPO | Proposed RTO | Proposed retention |
| --- | --- | ---: | ---: | ---: |
| 1 | Supabase Postgres data, Auth users, and migration history | 24 hours initially; evaluate 1 hour if the business cannot tolerate a workday of loss | 8 business hours | 30 daily recovery points |
| 1 | Supabase Storage objects in `project-files`, `takeoff-files`, and `certificate-files` | 24 hours | 8 business hours | 30 daily recovery points |
| 2 | Git source, migrations, Edge Function source, and build configuration | Every pushed commit | 1 hour | Full Git history plus an independent mirror |
| 2 | Netlify configuration, environment-variable manifest, domain routing, and last known good release | On every configuration change | 4 business hours | Current configuration plus change history |
| 2 | Supabase Auth/Storage/Realtime settings, Edge Function settings, and secret-name manifest | On every configuration change | 4 business hours | Current configuration plus change history |
| 3 | Sentry alerts, monitors, privacy settings, releases, and runbooks | 24 hours after a configuration change | 1 business day | Current configuration; event history is not a system of record |
| 3 | Firebase/FCM configuration and Android build credentials | On every configuration change | 1 business day | Current configuration plus one superseded version |
| Excluded | Unsaved browser drafts, local Takeoff autosave, caches, downloaded files, and device-only state | No guarantee | No guarantee | Best effort only |

The initial 24-hour Tier 1 RPO is a bounded baseline. Reducing the database RPO requires a provider-plan or automation decision and may add cost.

## Read-only inventory

### Supabase database and Auth

- Production project: **Project Hub**, project ref `oxojlwhmarafxuqvqgqg`, West US (Oregon).
- Live dashboard state on 2026-07-27: organization plan **Free** and **Last backup: No backups**.
- The repository contains 43 ordered migrations defining 42 public application tables, views/functions, RLS policies, audit behavior, normalized writes, and migration history.
- Business-critical rows include projects, tasks, People, application users and project access, schedules, files/photos metadata, selections, inspections, construction workflows, warranty/closeout, portal items, Takeoffs, audit events, and notification registration/delivery records.
- Supabase Auth users and password hashes live outside the public application tables. A complete logical recovery must include the applicable Auth schema/data, not only `public`.
- The staging authorization workflow can replay all tracked migrations and test role boundaries, but it is a test fixture path rather than a production-data backup.
- **Current coverage:** reproducible schema and authorization logic in Git; no production database recovery point.
- **Gap severity: critical.**

Supabase states that Free projects should regularly create off-site logical exports. Paid daily backups cover the database but do not include Storage objects. Point-in-Time Recovery can reduce database RPO but is a paid add-on with compute requirements.

### Supabase Storage

The recovery design covers three private buckets. The first two are live; `certificate-files` is introduced by the pending subcontractor-certificate migration:

- `project-files`: project files, project photos, inspection attachments, task attachments, selection attachments/photos, workflow attachments, invoices, warranty/closeout attachments, and related uploads.
- `takeoff-files`: source PDFs associated with saved Takeoffs.
- `certificate-files`: subcontractor insurance certificate PDFs and images, created and policy-backed by migration `20260728170000_add_subcontractor_insurance_certificates.sql`.

The `takeoff-files` bucket and its policies are created by a tracked migration. The repository references `project-files` and tracks later portal policies, but does not contain an idempotent migration that creates and fully configures that bucket. `SUPABASE_STORAGE_RLS_FIX.md` documents an older manual setup path and is not a complete recovery manifest.

Supabase database backups contain Storage metadata only; they do not restore the object bytes. Restoring database rows without matching objects would leave file metadata and Takeoff PDF references pointing to missing content.

- **Current coverage:** live provider copies only.
- **Gaps:** no independent object copy, no tested object restore, and incomplete bucket-configuration-as-code.
- **Gap severity: critical.**

### Edge Functions and Supabase platform configuration

Tracked function source:

- `create-auth-user` with JWT verification.
- `send-project-notification` with JWT verification.

Required secret/configuration names include the Supabase URL/service credentials and `FIREBASE_SERVICE_ACCOUNT_JSON`. Auth redirect URLs, email/SMTP settings, API keys, database settings/extensions, Storage configuration, Realtime settings, function deployments, and secret values are provider-managed and are not reconstructed by the SQL migrations alone.

- **Current coverage:** function source and JWT flags are in Git; deployed versions and behavior are documented in the handoff.
- **Gap:** no sanitized configuration manifest or independently stored credential-recovery record.

### GitHub

- `origin` is `https://github.com/rosegmp/projecttracker.git`.
- Source, migrations, two workflows, Android native source, dependency lockfile, tests, and operational documentation are tracked.
- CI rebuilds web and Android outputs. Debug APK artifacts have explicit 14-day retention and are rebuild artifacts, not durable backups.
- Required external values include `GOOGLE_SERVICES_JSON` and four staging-environment Supabase secrets.
- **Current coverage:** GitHub plus the active local clone.
- **Gaps:** no independently evidenced mirror/archive and no recoverable manifest for repository/environment settings or secret values.

GitHub recommends a mirror clone for repository backup. A migration archive contains selected metadata but is not a complete, directly restorable replacement for all GitHub features.

### Netlify

- Netlify hosts the production static client at `https://projecthub.destinyhomesnj.com`.
- The build is Git-backed and produces atomic deploys. Netlify can instantly republish an available prior successful deploy, but a later automatic Git deploy can replace that rollback.
- Runtime/build configuration uses Supabase and Sentry variable names and deploy-context-specific values. No secret values are committed.
- Netlify supports per-context environment-variable export and records environment-variable changes in its team audit log.
- **Current coverage:** source is reproducible from Git and prior Netlify deploys provide short-term release rollback.
- **Gaps:** no independently evidenced export of environment-variable keys/scopes/contexts, site settings, custom-domain/DNS configuration, or last-known-good release metadata.

### Sentry

- The repository contains the privacy contract, observability plan, response runbook, SDK configuration, release integration, and expected production alert thresholds.
- Provider-managed state includes the project, DSN, source-map token, alert rule, two metric monitors, members, and retention.
- Sentry is diagnostic rather than a business-data system of record. Loss of historical events would reduce incident context but would not prevent restoration of Project Tracker records.
- **Gap:** no sanitized configuration snapshot showing the current alert/monitor settings and member ownership.

### Firebase and Android

- Android native source and Capacitor configuration are tracked.
- `google-services.json` is intentionally ignored and supplied to CI through `GOOGLE_SERVICES_JSON`.
- FCM service credentials are stored as a Supabase Edge Function secret.
- Device tokens are database rows and can be re-registered by devices after recovery; notification history is not required to reconstruct project records.
- **Gap:** Firebase project ownership/configuration and credential-rotation recovery are not represented in a sanitized manifest.

### Client-local state

The client uses local/session storage and IndexedDB for authentication/session continuity, preferences, caches, and Takeoff crash recovery. These are not authoritative production backups. Recovery procedures must assume that browser/device state can be lost.

## Recovery gap register

| Priority | Gap | Consequence | Required next action |
| --- | --- | --- | --- |
| Critical | Free Supabase production project reports no backups | Database/Auth loss may be unrecoverable | Establish a daily encrypted logical export or approve a paid backup option |
| Critical | Storage object bytes require independent backup | Documents, photos, attachments, Takeoff PDFs, and insurance certificates may be unrecoverable even if database rows survive | Back up every private application bucket to an independent, versioned destination |
| High | `project-files` bucket creation/configuration is not fully migration-backed | A new project cannot be recreated consistently from Git alone | Add an idempotent bucket/configuration migration after comparing live policies |
| High | No restore drill | Backup completeness and real recovery time are unknown | Restore into an isolated non-production project and run verification |
| High | Provider configuration and secret values have no recovery manifest | Recreated services may build but fail Auth, telemetry, deployment, or push | Store an encrypted owner-controlled configuration/credential recovery record |
| Medium | No independent Git mirror is evidenced | GitHub account/repository loss increases source-recovery risk | Create a scheduled mirror archive outside GitHub |
| Medium | No named backup responder | Recovery depends on one person | Assign a second authorized responder before claiming resilient coverage |
| Low | APK artifact retention is 14 days | A past debug build may expire | Rebuild from a tagged commit; preserve only signed release artifacts when distribution begins |

## Milestone 3.2 selected path

The repository owner selected **Path A: remain on Supabase Free** on 2026-07-27. Production will use encrypted daily logical exports rather than a paid Supabase database-backup or PITR add-on.

### Selected: Path A — remain on Supabase Free

- Run daily logical exports of roles, schema, data, and migration history using the supported Supabase CLI process.
- Encrypt before transfer and store outside GitHub, Netlify, the active workstation, and the production Supabase organization.
- Retain 30 daily copies and record a checksum plus privacy-safe aggregate manifest.
- Separately copy both Storage buckets to the same independently controlled, versioned backup destination.

### Not selected: Path B — paid Supabase database recovery

- Use paid daily database backups as the baseline, or evaluate PITR if an approved RPO requires it.
- Still create an independent Storage-object backup because Supabase database backups and project cloning do not copy object bytes.
- Still retain configuration and credential recovery records outside the production account.

Provider backup status is not a substitute for a restore drill. Path B reduces database automation work but does not close Storage or configuration gaps.

### Selected destination: Backblaze B2

The repository owner selected **Backblaze B2** on 2026-07-27 as the independent backup destination. Use one private, S3-compatible bucket created specifically for Project Tracker recovery data.

Required destination configuration:

- Enable Object Lock when the bucket is created.
- Begin with a 30-day default retention period in governance mode while backup and restore automation is validated. Consider compliance mode only after the first isolated restore drill passes because compliance retention cannot be shortened or bypassed before expiry.
- Do not enable public file listing or public object access.
- Create a dedicated application key restricted to this bucket. Do not use the B2 account master application key.
- Store the key id, application key, S3 endpoint, bucket name, region, and backup encryption secret only in the approved automation secret store and owner-controlled recovery record.
- Keep B2 account recovery and multifactor authentication independent of the production Supabase, Netlify, and GitHub credentials where practical.
- Treat B2 server-side encryption and Object Lock as destination safeguards, not a replacement for encrypting database dumps and manifests before upload.

The remaining external prerequisite is creation of the B2 bucket and restricted application key by the account owner. Production export automation must fail closed until every required destination and encryption value is configured.

## Milestone 3.2 implementation boundaries

After the owner chooses a path and destination, implement only:

1. A secret-safe backup runner that fails closed when production identifiers or destination credentials are missing.
2. Logical database exports that follow Supabase's roles/schema/data sequence and preserve migration history.
3. Recursive exports of `project-files`, `takeoff-files`, and `certificate-files`.
4. Encryption in transit and at rest with destination credentials separate from production credentials.
5. A manifest containing timestamps, tool versions, checksums, aggregate table/object counts, and success/failure status—never row content, object names, credentials, URLs with secrets, or customer/project identifiers.
6. Retention enforcement only after a newer backup is verified.
7. Alerts for missed/failed backups without attaching backup contents.

Do not:

- commit exports, secret values, database URLs, service-role keys, customer data, or object listings;
- upload production backups as ordinary GitHub Actions artifacts;
- store the only backup in the same Supabase organization, Netlify account, workstation, or repository;
- run destructive restore commands against production;
- claim an RPO/RTO until two scheduled backups and one isolated restore drill have passed.

### Implementation checkpoint prepared

The repository now contains a manual-first `Production recovery backup` GitHub workflow and a fail-closed runner for the approved production project and B2 destination.

- The runner follows Supabase's supported roles, schema, data, and migration-history dump sequence.
- It recursively downloads `project-files`, `takeoff-files`, and `certificate-files` through the authenticated Storage API.
- The plaintext working set exists only in a restricted temporary runner directory and is encrypted with GnuPG AES-256 before transfer.
- Each B2 object receives an explicit 30-day governance retention timestamp. The restricted automation key must not have `bypassGovernance`.
- The runner downloads the encrypted B2 object and verifies its SHA-256 checksum, then verifies the retained object's Object Lock mode.
- The encrypted manifest contains fixed SQL artifact hashes, aggregate COPY section/row counts, aggregate per-bucket object/byte counts, tool versions, and workflow identifiers. It contains no database values or object names.
- The scheduled trigger remains disabled unless repository variable `PRODUCTION_BACKUPS_ENABLED` is exactly `true`; manual dispatch is available for the first validation.
- No backup is uploaded as a GitHub artifact, and the workflow does not delete B2 recovery points.
- `PRODUCTION_BACKUP_RUNBOOK.md` defines the six required `production-backup` environment secrets and the manual-first activation procedure.

### First recovery point and daily activation

- GitHub environment `production-backup` contains all six required secrets. Their values are not stored in Git, job artifacts, summaries, or this plan.
- The first two manual attempts failed closed before creating a recovery point: run `30300098932` rejected a missing database URL, and run `30300422870` rejected invalid pooler authentication. Neither attempt reached Storage export or B2 upload.
- Manual run `30300685312` passed on 2026-07-27 in 3 minutes 38 seconds. It completed all five logical dumps, exported both Storage buckets with 96 aggregate objects, encrypted the complete working set, uploaded a 317,835,231-byte B2 object, downloaded it, matched its SHA-256 checksum, and verified `GOVERNANCE` Object Lock with 30-day retention.
- Repository variable `PRODUCTION_BACKUPS_ENABLED=true` now activates the daily 07:17 UTC schedule.
- No backup content or object listing was uploaded as a GitHub artifact. Job output contained only fixed stage names and privacy-safe aggregate counts/sizes.

This establishes one verified recovery point, not a proven RPO/RTO. Keep milestone 3.2 open until a second scheduled recovery point passes. Do not configure lifecycle deletion or claim the recovery targets until the isolated restore drill also passes.

## Milestone 3.3 isolated restore drill

### Approved first-drill target and prepared automation

The owner approved overwriting the non-production **Project Hub Staging** project (`kvvvzthzdvzfovphrnlq`) for the first drill. Supabase Free permits only two active projects for this account, so a third disposable project could not be created; production project `oxojlwhmarafxuqvqgqg` remains a fixed rejected target. The staging database password was rotated, and the recovery URL, session-pooler URL, anon key, and service-role key are stored only as protected GitHub environment secrets.

The manual-only `Isolated production recovery restore drill` workflow requires the exact confirmation `OVERWRITE_PROJECT_HUB_STAGING`. Its runner verifies the newest B2 object's Governance retention, encrypted checksum, production source-ref hash, database-file hashes, expected bucket set, and safe COPY targets before connecting to the target. It restores the database/Auth and migration history using the documented roles/schema/replica/data sequence, restores all three Storage buckets, checksum-verifies one downloaded object from each non-empty bucket, compares aggregate database/migration/object counts, builds an isolated Sentry-disabled client, runs the disposable authorization suite, and checks the three existing staging Edge Functions' JWT boundary. Decrypted contents remain in one restricted runner directory and are never uploaded as artifacts.

This is a prepared checkpoint, not a completed drill. Do not claim the proposed RPO/RTO, enable lifecycle deletion, or reset staging until the workflow passes, evidence is retained, and the owner approves cleanup.

Use a disposable or dedicated recovery Supabase project that is not production and is protected from public traffic.

1. Record production backup timestamp and checksums.
2. Restore roles, schema, data, Auth, and migration history using the documented Supabase sequence.
3. Recreate bucket settings and upload backed-up objects without overwriting another environment.
4. Deploy both Edge Functions and reapply non-production secrets/configuration.
5. Point an isolated client build at the recovery project.
6. Verify:
   - aggregate table counts and key foreign-key relationships;
   - storage metadata count equals restored object count for both buckets;
   - representative files and Takeoff PDFs download successfully;
   - a normalized Takeoff reopens with sheets, scales, measurements, and markups;
   - Admin, internal user, Customer, and Subcontractor authorization boundaries pass;
   - the staging authorization suite passes and cleans up its fixtures;
   - no production notification, Sentry event, email, or external portal action is emitted.
7. Record actual RPO/RTO, failures, manual steps, and cleanup.
8. Delete the disposable environment only after evidence is retained and the owner approves cleanup.

## Milestone 3.4 rollback and full incident recovery

### Prepared non-destructive rehearsal — 2026-08-04

`INCIDENT_RECOVERY_RUNBOOK.md` now defines fixed production identifiers, responder authority, a first-ten-minute checklist, incident decision table, Netlify lock/publish/unlock sequence, Git revert versus forward-fix rules, full recovery order, maintenance communications, post-recovery rotation/audit work, and explicit production approval checkpoints.

The read-only inventory confirmed that Netlify retains ready atomic production deploys and deploy permalinks, but auto publishing is active and GitHub `main` is not protected. Recovery-documentation commits were therefore published even while GitHub's production dependency audit was red. The failure was a newly published high-severity advisory in transitive `brace-expansion` 5.0.8; application tests, browser journeys, build, database authorization tests, and Android compilation passed. The correct response is the non-breaking 5.0.9 lockfile forward fix, not a web/database rollback.

The repository now includes a fail-closed read-only rollback-readiness checker and deterministic tests. It requires a clean `main`, fixed Netlify site/URL, a matching latest CI run, and two retained ready production deploys before it checks the production and candidate permalinks. A published deploy behind `main` is accepted only when it is an ancestor of `main` (for example, after an intentional `[skip netlify]` operations commit) and is reported for attention. It reports branch-protection and CI gaps without emitting full provider responses.

No production deploy was locked, restored, published, or unlocked during the initial rehearsal. The remaining decisions are how to implement a server-enforced write freeze that covers installed Android clients and who will be the second authorized responder.

The validated checkpoint is `c4d198b` with Windows invocation follow-up `5aafa26`. GitHub Actions run `30913808720` passed the complete web, database, and Android gate. The live read-only rehearsal returned HTTP 200 for both production and the retained rollback candidate. Both commits used `[skip netlify]`, so the production deploy intentionally remains at its verified ancestor `351a50a`; no production state was mutated.

On 2026-08-04 strict GitHub protection was enabled on `main`. Web/tests/audit, Supabase authorization, and Android build checks are all required and must be current with the base branch. The rule applies to administrators and disallows force pushes and branch deletion.

CI-gated Netlify publishing was implemented in merge commit `6fe8e34`. The current production deploy is locked, so Git-triggered builds cannot auto-publish. After successful push-triggered `main` CI, `.github/workflows/publish-production.yml` finds the ready deploy for the exact tested commit and fixed site, publishes it atomically, verifies both production and deploy URLs, and immediately re-locks it. Operations commits containing `[skip netlify]` are ignored. The Netlify credential is stored only in GitHub's protected `production` environment. Four deterministic tests cover exact commit/site selection, build readiness, URL boundaries, and current-deploy selection.

Document and rehearse:

- Netlify release rollback and deploy locking;
- Git revert/redeploy for application regressions;
- forward-fix versus database restore criteria for migrations;
- maintenance communication and write freeze during data recovery;
- restoration order: credentials/configuration, database/Auth, Storage objects, Edge Functions, client deploy, validation, then traffic;
- post-recovery key rotation, audit review, notification-token refresh, and Sentry verification;
- primary and backup responder ownership.

## Official references

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Supabase CLI Storage commands](https://supabase.com/docs/reference/cli/overview)
- [Netlify deploy rollback and locking](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- [Netlify environment-variable import/export](https://docs.netlify.com/build/environment-variables/get-started/)
- [GitHub repository backup](https://docs.github.com/en/repositories/archiving-a-github-repository/backing-up-a-repository)
- [Backblaze B2 S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- [Backblaze B2 Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock)
