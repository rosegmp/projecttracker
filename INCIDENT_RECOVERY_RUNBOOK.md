# Project Tracker rollback and incident recovery runbook

Status: prepared for a non-destructive rehearsal. Do not lock, publish, roll back, restore, revoke access, or rotate credentials until the incident commander approves the applicable checkpoint.

## Fixed production identifiers

- GitHub repository: `rosegmp/projecttracker`
- Production branch: `main`
- Netlify project: `destinyprojecthub`
- Netlify project id: `f15655fa-bfab-410a-a475-693ca0add6ae`
- Production URL: `https://projecthub.destinyhomesnj.com`
- Production Supabase project ref: `oxojlwhmarafxuqvqgqg`
- Recovery destination: private B2 bucket `dph-recovery-2458`

Any command or dashboard page that identifies a different production project, site, branch, URL, or bucket is out of scope and must stop.

## Roles and authority

- **Incident commander:** Project Tracker repository and Supabase owner. Declares the incident, approves production locks/rollbacks/restores, assigns the write-freeze owner, and closes the incident.
- **Deployment operator:** Netlify owner. Records the current deploy id and commit before locking or publishing a deploy.
- **Database recovery operator:** Supabase and B2 owner. Confirms the selected recovery point, RPO, target project, and restore validation.
- **Observer/communications owner:** Records timestamps and aggregate evidence and sends maintenance updates without customer record details.
- **Backup responder:** not yet assigned. Until a second authorized person is named, do not represent this as 24/7 or two-person recovery coverage.

## First ten minutes

1. Open one incident record with start time, reporter, observed symptom, affected surfaces, and incident commander. Do not paste tokens, SQL row content, object names, customer/project names, or provider response bodies.
2. Stop new releases. Do not merge, push migrations, deploy Edge Functions, or rotate credentials while diagnosis is in progress.
3. Record the currently published Netlify deploy id/commit and the current Git `main` commit. A mismatch is evidence, not permission to publish.
4. If the live client is causing damage or a rollback is probable, the Netlify owner locks the currently published deploy before another Git deploy can overwrite the response.
5. Announce maintenance using the template below, enable the server-enforced write freeze, and confirm its status before selecting a recovery point.
6. Record the newest verified B2 recovery-point timestamp and calculate its potential data-loss window. Do not restore merely because a backup exists.
7. Classify the incident with the decision table. Prefer a forward fix when data is intact and a bounded fix is safer than losing post-backup work.

## Decision table

| Condition | Default response | Database action |
| --- | --- | --- |
| Broken client bundle, routing, or rendering; server data remains valid | Lock Netlify, publish a previously verified atomic production deploy, then create a Git revert or forward-fix commit | None |
| Newly published dependency advisory with no evidence of exploitation or runtime failure | Keep the application available; patch the lockfile, run the release gate, and roll forward | None |
| Edge Function regression with compatible database state | Stop the affected caller if necessary, redeploy the last verified function source or a forward fix, then validate authorization | None |
| Additive/compatible migration defect with intact rows | Create and test a new forward migration; never edit or delete an already-applied production migration | None |
| Destructive migration, widespread row corruption, or unrecoverable authorization damage | Freeze writes, preserve evidence, select an approved recovery point, and obtain explicit restore approval | Restore only after the RPO/data-loss decision is accepted |
| Credential compromise | Freeze affected integrations, rotate the compromised credential, redeploy/reconfigure consumers, invalidate old sessions where applicable, and audit access | Restore only if data integrity was also lost |
| Provider outage without corruption | Hold changes, communicate, and monitor provider status | No restore to the same unavailable provider |

Supabase migration history is not a rollback mechanism. `migration repair` changes history records only. Production schema changes roll forward through a new reviewed migration. A database restore is a last-resort data recovery action, not a substitute for a down migration.

## Netlify client rollback

Netlify deploys are atomic. Publishing an earlier successful production deploy changes only the web client; it does not roll back Supabase data, migrations, Auth, Storage, Edge Functions, or secrets.

1. In **Netlify → destinyprojecthub → Deploys**, record the published deploy id and commit.
2. Select **Lock** to stop auto publishing. Confirm the live deploy reports locked before proceeding.
3. Open the intended prior successful **production** deploy. Confirm:
   - project id and production URL match this runbook;
   - state is `ready` and context is `production`;
   - its commit exists in `rosegmp/projecttracker`;
   - its deploy permalink returns HTTP 200;
   - its client is compatible with the current production database schema.
4. Select **Publish deploy**. Record the old/new deploy ids, commits, operator, approval, and timestamp.
5. Verify sign-in, Home, a read-only project view, and the specific broken journey. Do not create production test data unless the incident commander approved it.
6. Keep the deploy locked while the Git revert or forward fix passes CI. Publishing an old deploy does not change `main`; a later auto-published Git deploy would otherwise overwrite the rollback.
7. Publish the corrected production deploy, complete smoke checks, then explicitly unlock auto publishing only after the incident commander approves.

The equivalent Netlify API operations are `lockDeploy`, `restoreSiteDeploy`, and `unlockDeploy`. Treat each as a production mutation. Use the recorded ids as explicit arguments; never select “latest” inside a mutating command.

## Git correction

- For a self-contained client regression, create a new `git revert <bad-commit>` commit. Do not rewrite `main` or force-push.
- If later commits contain unrelated good work, create a narrow forward fix instead of reverting the entire range.
- Never revert an applied migration file out of Git. Add a later migration that safely moves the live schema forward.
- Require the regression suite, browser journeys, production build, production dependency audit, database authorization tests, and Android build when runtime source changed.
- Operational documentation and rehearsal commits should include `[skip netlify]` so they do not create an unnecessary production deploy. This does not replace CI.

## Normal production publishing

Netlify auto publishing is disabled by locking the currently published deploy. New `main` commits may still build, but they do not become live until the tested-deploy workflow publishes them.

1. Changes merge to protected `main` only after the required web, database, and Android checks pass.
2. The push-triggered `main` CI run repeats the complete gate on the merge commit.
3. `.github/workflows/publish-production.yml` runs only when that CI run succeeds. It uses the protected `production` environment and does not run for pull requests or feature branches.
4. The publisher waits for a ready production-context Netlify deploy whose site id, branch, URL, and full commit hash exactly match the tested merge commit.
5. It publishes that atomic deploy, re-locks it, checks HTTP success for production and the deploy-specific URL, and verifies that the published locked deploy still matches the tested commit.
6. A commit containing `[skip netlify]` or `[netlify skip]` completes the workflow without publishing. Use this only for operations/docs changes that do not alter the production bundle.

If CI fails, the publisher does not run and the existing locked production deploy remains live. If the publisher cannot prove an exact deploy match or any API/HTTP check fails, it stops without selecting another deploy. `NETLIFY_AUTH_TOKEN` is stored only in GitHub's protected `production` environment; never print, copy into repository files, or include it in an incident record.

## Write freeze and maintenance

Project Tracker has one server-enforced application write freeze. It blocks authenticated and anonymous writes to public application tables and private Storage objects, including calls made by older installed Android clients. The current web/Android client remains readable, displays a maintenance banner, hides top-level editing entry points, and pauses queued offline mutations until the freeze is released. The three application Edge Functions also reject invitations, notifications, and certificate extraction with HTTP 503 and code `APP_WRITES_FROZEN`.

The database recovery operator must use the Supabase SQL Editor or another approved direct database session. Never place credentials in the incident record and never update `app_runtime_controls` directly.

1. Announce maintenance and record the incident id and intended effective time.
2. Enable the freeze with an incident-specific message:

   ```sql
   select public.set_app_write_freeze(
     true,
     'Project Tracker is temporarily read-only while recovery validation is in progress.',
     'INC-YYYYMMDD-NN'
   );
   ```

3. Confirm the returned and current status both show `"writesFrozen": true`:

   ```sql
   select public.get_app_runtime_status();
   ```

4. Confirm an authenticated client can still read Home and a project, displays the maintenance banner, and receives `APP_WRITES_FROZEN` for a write. Do not create production test records. Offline changes must remain pending rather than becoming failed items.
5. Compare application/database activity timestamps against the confirmed freeze time before selecting a recovery point. The append-only `app_runtime_control_events` table records activation and release metadata.
6. Complete the recovery validation sequence. Service-role and direct recovery/database sessions are not denied by the freeze guards, although their ordinary grants still apply, so authorized recovery operations remain possible. Edge Functions explicitly honor the freeze even though they use a service-role client.
7. Release the freeze only after database, Storage, authorization, Edge Function, web, and Android checks pass:

   ```sql
   select public.set_app_write_freeze(false, '', 'INC-YYYYMMDD-NN');
   select public.get_app_runtime_status();
   ```

8. Confirm `"writesFrozen": false`, send the all-clear, and monitor queued Android/web sync plus normal mutation/error telemetry.

The freeze is intentionally scoped to application database and Storage writes and the three application Edge Functions. It does not prevent Supabase Auth credential/session operations, provider-console changes, direct database/recovery work, or external notifications already in flight. Handle those surfaces separately when the incident requires it.

### Maintenance message

> Project Tracker is temporarily in maintenance while we investigate a service issue. Please stop editing in the web and Android apps until an all-clear is sent. We will provide the next update at [time].

### All-clear message

> Project Tracker service has been restored and validation is complete. Editing may resume. Changes submitted after [recovery point/freeze time, if applicable] should be reviewed with the project team.

## Full data recovery order

1. Declare maintenance and establish the write freeze.
2. Preserve privacy-safe evidence and record the selected recovery point, checksum, age, and accepted RPO.
3. Recover owner access and required configuration/credential names. Never place secret values in the incident record.
4. Restore database roles, schema, data, Auth, and migration history into the approved target.
5. Restore all three private Storage buckets and verify aggregate counts plus representative downloads.
6. Reapply platform configuration and deploy `create-auth-user`, `send-project-notification`, and `extract-insurance-certificate` with target-specific secrets.
7. Build the client against the recovered target with Sentry disabled until validation finishes.
8. Run aggregate relationship checks, normalized Takeoff checks, Admin/Edit/View Only/Customer/Subcontractor authorization tests, and fixture cleanup.
9. Configure the production client and domain only after the incident commander accepts validation evidence.
10. Resume traffic and writes, then monitor Supabase, Netlify, Sentry, notification delivery, and user reports.

## Post-recovery

- Rotate database passwords, service-role/API keys, B2 keys, Netlify tokens, Supabase access tokens, Firebase credentials, Sentry tokens/DSN if exposed, and affected user sessions. Rotate only credentials in scope; record names and completion, never values.
- Review Supabase Auth/audit logs, database audit events, Netlify deploy history, GitHub audit/activity, B2 access, and Sentry without exporting customer content.
- Expect Android notification tokens to re-register. Validate one authorized multi-user notification path without using production customer records as fixtures.
- Confirm scheduled backups resume and the newest post-recovery point passes checksum/Object Lock verification.
- Write a timeline, root cause, data-loss statement, control failures, follow-up owners, and due dates.

## Non-destructive rehearsal evidence — 2026-08-04

- The linked Netlify site id and production URL match this runbook.
- Recent production deploys are atomic, `ready`, and retain deploy permalinks suitable for preflight HTTP checks.
- Netlify production is locked and exact-commit publishing is gated by successful push CI through the protected `production` environment.
- GitHub `main` has strict required web, database, and Android checks, including for administrators; force pushes and branch deletion are disabled.
- The latest failure was a new transitive dependency advisory while application tests, browser journeys, build, database authorization tests, and Android build passed. The correct response is a lockfile forward fix, not a client/database rollback.
- No Netlify deploy was locked, published, restored, or unlocked during this rehearsal. Production data and traffic were not changed.

## Approval checkpoints still open

1. Assign a second authorized recovery responder.

## References

- [Netlify deploy rollbacks and locks](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- [Netlify deploy API](https://open-api.netlify.com/)
- [Supabase production migration workflow](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase declarative schema rollback guidance](https://supabase.com/docs/guides/local-development/declarative-database-schemas)
- [Project Tracker recovery plan](RECOVERY_PLAN.md)
- [Project Tracker observability response runbook](OBSERVABILITY_RUNBOOK.md)
