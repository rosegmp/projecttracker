# Project Tracker observability runbook

Updated: 2026-07-26

## Scope

This runbook covers production error health for the React web client and Capacitor Android container. It does not enable tracing, session replay, user tracking, screenshots, console capture, analytics, or a paid log drain.

Because the privacy-safe SDK does not collect sessions or request traces, Project Tracker cannot calculate a truthful percentage failure rate. Milestone 2.3 therefore alerts on sustained report volume. Do not label these thresholds as a percentage of users or requests.

## Signal ownership

- The Project Tracker repository owner is the primary Sentry and production-deployment responder.
- The Netlify project owner owns failed production builds and rollback decisions.
- The repository owner owns failed GitHub Actions checks and must not treat a deployment as healthy while required checks are failing.
- A backup responder is not currently documented. Add one Sentry organization member before representing this as 24/7 coverage.
- There is no after-hours paging commitment. Production-unavailable or repeated-fatal alerts should be acknowledged within 30 minutes when actively monitored; other alerts should be triaged by the next business day.

## Production Sentry alert rules

All rules must be limited to the `project-tracker` project and `production` environment. Email the Project Tracker Sentry project owner. Set the action interval to one hour so a continuing incident does not send a message for every event.

### 1. New or regressed production issue

- Name: `Production - new or regressed issue`
- Trigger when an issue is first seen or changes from resolved to unresolved.
- Notify immediately.
- Purpose: catch a new release regression without waiting for a volume threshold.

### 2. Repeated fatal render failure

- Name: `Production - repeated fatal render failure`
- Filter to event level `fatal`.
- Trigger when the same issue occurs at least 3 times in 5 minutes.
- Purpose: identify a workspace render failure that repeatedly leaves a screen unusable.

Only `AppErrorBoundary` reports at `fatal`. Background queries, mutations, notification delivery, and startup degradation remain `error`; expected validation, authentication, authorization, offline, cancellation, not-found, and concurrency outcomes remain suppressed.

### 3. Sustained issue volume

- Name: `Production - sustained issue volume`
- Trigger when the same issue occurs at least 10 times in 15 minutes.
- Purpose: catch a repeated production defect without enabling tracing or stable user/session identifiers.

The rule measures reports for one grouped issue, not unique users and not a request failure percentage.

## Release and deployment health

- Trusted builds use the deploy commit as the Sentry release name and attach commits automatically.
- When Sentry upload credentials and `VITE_SENTRY_ENVIRONMENT` are present, the trusted build creates a Sentry deploy record for that release and environment.
- The deploy record uses the Netlify context as its name and the HTTPS deploy URL when Netlify supplies one.
- Local and untrusted builds do not upload source maps or create Sentry releases/deploys.
- A release is healthy only after required GitHub checks pass, Netlify reports the production deploy complete, the live site returns HTTP 200, and no new production regression or sustained-volume alert appears.

## Triage

1. Confirm the Sentry environment is `production` and note the release commit.
2. Use only approved tags: `operation`, `platform`, `request_id`, `support_id`, and `workspace`.
3. For a privileged-function failure, copy `request_id` into the documented Supabase `function_logs` query. Never search by customer, project, address, email, or payload content.
4. Check the matching GitHub Actions run and Netlify deployment for the release.
5. Classify:
   - repeated fatal render failure or unavailable production site: urgent;
   - new/regressed issue: investigate before the next release;
   - sustained issue volume: investigate by the next business day, escalating if it blocks a core workflow.
6. Roll back only to a previously verified production release. Preserve the failing release and request/support ids in the incident notes.
7. Resolve the Sentry issue after a verified fix is deployed and remains quiet for 24 hours.

## Privacy verification

If any alert email or Sentry event contains a name, email, address, project/customer content, credential, request body, raw URL identifier, or stable user identifier:

1. disable the affected alert notification;
2. stop intentional validation events;
3. preserve only the event id and support/request ids;
4. correct the scrubber or reporting boundary;
5. repeat the staging privacy checklist before restoring production notifications.
