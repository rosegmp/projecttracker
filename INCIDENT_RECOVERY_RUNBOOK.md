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
5. Announce maintenance using the template below. Ask active field users to stop editing; Android clients may remain capable of writes even if the web deploy is locked.
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

## Write freeze and maintenance

Project Tracker does not currently have one authoritative maintenance switch that blocks writes from web and already-installed Android clients. A Netlify lock stops auto publishing but does not stop application writes. Asking users to stop editing is a coordination control, not a technical guarantee.

Until a tested server-side maintenance control exists:

1. Announce the freeze and record its effective time.
2. Avoid broad SQL grants/revokes or database-wide read-only settings during an incident unless a separately reviewed procedure has been rehearsed; managed Auth, Storage, and recovery connections may also be affected.
3. Use a bounded deny policy/RPC guard only if it was prepared and tested before the incident. Do not invent emergency RLS changes while data is already at risk.
4. Compare database activity timestamps against the freeze time before choosing a recovery point.
5. Resume writes only after database, Storage, Auth, Edge Functions, client, and authorization checks pass.

This missing server-side write freeze is an open recovery-control decision, not a completed capability.

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
- Auto publishing is active; recent recovery-documentation commits were published even though GitHub's production dependency audit failed.
- GitHub `main` is not protected. This allows direct pushes without required status checks.
- The latest failure was a new transitive dependency advisory while application tests, browser journeys, build, database authorization tests, and Android build passed. The correct response is a lockfile forward fix, not a client/database rollback.
- No Netlify deploy was locked, published, restored, or unlocked during this rehearsal. Production data and traffic were not changed.

## Approval checkpoints still open

1. Enable GitHub branch protection/rules for `main` with required CI checks.
2. Decide whether Netlify production should remain auto-published or stay locked until CI passes and an operator publishes the prepared deploy.
3. Design and rehearse a server-enforced maintenance/write-freeze control that also covers installed Android clients.
4. Assign a second authorized recovery responder.

## References

- [Netlify deploy rollbacks and locks](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/)
- [Netlify deploy API](https://open-api.netlify.com/)
- [Supabase production migration workflow](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase declarative schema rollback guidance](https://supabase.com/docs/guides/local-development/declarative-database-schemas)
- [Project Tracker recovery plan](RECOVERY_PLAN.md)
- [Project Tracker observability response runbook](OBSERVABILITY_RUNBOOK.md)
