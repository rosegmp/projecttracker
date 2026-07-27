# Production observability plan

Updated: 2026-07-26

## Goal

Detect actionable Project Tracker failures across the web client and Android app without collecting project content, file names, customer details, request payloads, credentials, or routine user mistakes.

## Current-state inventory

- `AppErrorBoundary` prevents a failed workspace render from taking down the whole shell, but it only displays the raw error message and does not implement `componentDidCatch` or report the exception.
- Startup, deferred hydration, notification actions, and most page mutations surface useful messages to the user. Reporting is inconsistent because failures are handled independently across `App.jsx`, `useEntityMutations`, `QueryClient`, project managers, Takeoff, and platform adapters.
- `QueryClient` retains terminal query/mutation errors in memory but has no reporting callback. `useEntityMutations` tracks pending state but does not observe rejected operations.
- Unhandled browser errors and rejected promises have no application-owned capture path.
- Console warnings and errors are local to the current browser or WebView and disappear when the session ends.
- Netlify hosts the static client and reports build/deployment health, but it cannot see React runtime exceptions in a user's browser.
- Supabase already records API, Auth, Storage, Postgres, and Edge Function activity in its Logs Explorer. The two Edge Functions currently rely primarily on automatic invocation/platform logging and do not share an application correlation id.
- Firebase is configured for Android push notifications only. Crashlytics and Analytics are not installed.
- CI verifies regressions, browser journeys, builds, dependency health, Android compilation, local pgTAP authorization, and the manual hosted-staging authorization suite. It does not verify a production error-reporting transport.

## Provider decision

Use one Sentry project with the official `@sentry/react` and `@sentry/capacitor` SDKs at matching exact versions.

Reasons:

- one issue stream can cover the React web build and the Capacitor Android container;
- the current official Capacitor package supports Capacitor 8;
- React render failures, browser errors, unhandled promise rejections, manual mutation reports, releases, and source maps can use one reporting abstraction;
- it avoids creating an application-writable Supabase error table that would fail during Supabase outages and add a new abuse/authorization surface;
- Firebase Crashlytics remains a possible later native-only supplement for Android crashes and ANRs, not the primary Project Tracker reporting path.

Official references:

- https://github.com/getsentry/sentry-capacitor
- https://github.com/getsentry/sentry-javascript
- https://supabase.com/docs/guides/telemetry/logs
- https://firebase.google.com/docs/crashlytics/android/get-started

## Privacy contract

The first release reports errors only.

Allowed:

- exception type, sanitized message, and stack trace;
- release commit, environment, web/Android platform, app version, and permitted workspace/tab id;
- bounded operation category such as `project.save`, `task.create`, `startup.bootstrap`, or `storage.upload`;
- HTTP status and normalized Supabase/Postgres error code when present;
- a random per-error support id shown to the user.
- a random per-request correlation id for privileged Edge Function failures.

Forbidden:

- names, email addresses, phone numbers, street addresses, project names, company names, notes, descriptions, comments, file names, or document contents;
- access tokens, refresh tokens, API keys, cookies, authorization headers, database URLs, request/response bodies, or Supabase payloads;
- raw URLs or query strings, because Project Tracker routes may contain project or entity ids;
- session replay, screenshots, DOM text capture, console capture, performance traces, or user-input breadcrumbs;
- stable user identifiers during the initial milestone.

Required SDK configuration:

- disabled unless a valid production/staging DSN is explicitly supplied;
- default PII collection disabled;
- session replay and tracing disabled;
- a `beforeSend` scrubber removes request data, headers, cookies, user data, breadcrumbs, extras outside the allowlist, and URL query/fragment data;
- expected validation, authentication rejection, offline, cancellation, authorization `401/403`, not-found, and optimistic-concurrency errors are not reported as application defects;
- staging and production use distinct environments and alerts.

## Bounded implementation milestone 2.1

1. Add a provider-neutral `observability` service with disabled-by-default initialization, error classification, metadata allowlisting, redaction, and a test sink.
2. Add Sentry React/Capacitor packages at matching exact versions and initialize them before React mounts only when `VITE_SENTRY_DSN` is configured.
3. Report React render failures through `componentDidCatch`, with a retry action and a support id that does not expose the raw exception to portal users.
4. Report terminal `QueryClient` and `useEntityMutations` failures once, using normalized operation categories rather than record values.
5. Report startup/deferred-hydration and notification-action failures that are currently only shown locally or silently ignored.
6. Generate hidden production source maps, upload them during trusted builds using a scoped `SENTRY_AUTH_TOKEN`, and remove them from the published `dist` output after upload.
7. Add deterministic tests for disabled mode, redaction, expected-error suppression, render-boundary reporting, mutation deduplication, and support ids.
8. Validate first in staging with an intentional sanitized test exception, confirm the event contains no forbidden fields, then remove the trigger before production activation.

### Implementation status

- Steps 1–8 are implemented and verified at the commit and staging checkpoints.
- The privacy contract is approved, and the Sentry project plus Netlify runtime/build variables are configured.
- All 125 regression tests, all 9 Playwright journeys, the production build, dependency audit, Capacitor sync, Android debug build, syntax checks, and `git diff --check` pass.
- A Netlify Deploy Preview sent an intentional `staging` exception containing fake private markers. The repository owner inspected the received event and confirmed that the complete privacy checklist passed. The temporary trigger and transport probes are absent from the clean production change.
- Validation also added a bounded wait for Capacitor's asynchronous sibling-client initialization, updated audited `brace-expansion` to 5.0.8, and documented that browser tracking prevention can block direct Sentry delivery.
- Production activation was explicitly approved and deployed from commits `e50610b` and `9e8c725`. The live site returns HTTP 200 with production Sentry configuration and no validation instrumentation; GitHub Actions run `30219313372` passed every web, authorization, and Android job. No intentional production event was sent.

## External prerequisites and approval boundary

Milestone 2.1 activation required the repository owner to:

1. create or select a Sentry organization and Project Tracker project;
2. accept the provider's plan, retention, data-processing, and access settings;
3. supply the web/Capacitor DSN through Netlify and local staging configuration;
4. create a least-privilege source-map upload token and store it as a GitHub/Netlify secret;
5. approve the privacy contract above.

These prerequisites, the staging-event inspection, and final production approval are complete. Privacy-safe error telemetry is active in production. Supabase log drains, Crashlytics, Analytics, replay, and tracing remain inactive.

## Milestone 2.2: backend correlation

Implementation and production activation are complete.

- The client creates a fresh `REQ-` value for each privileged Edge Function call. The function accepts only the exact opaque format, generates a replacement for malformed or absent values, and returns the accepted id in the JSON body plus `x-request-id`.
- `create-auth-user` and `send-project-notification` emit structured failure lines with only six fields: `event`, `function`, `operation`, `status`, normalized `code`, and `request_id`.
- Raw caught error messages and downstream response content are excluded from application logs and function error responses. The notification function still examines Firebase response content in memory to retire invalid tokens, but never logs or returns that content.
- Client errors retain the request id. Reportable failures add it as the allowlisted Sentry `request_id` tag; expected operational failures remain suppressed.
- No log drain, external backend telemetry sink, replay, tracing, or new stable identifier is enabled.

### Supabase Logs Explorer lookup

1. Copy the `request_id` tag from the sanitized Sentry event.
2. In the production Supabase project, open **Logs → Logs Explorer**, use a narrow time range, and select the `function_logs` source.
3. Search the event message for the complete opaque id. Never search by an email, project name/id, notification text, or other customer content.
4. With the current ClickHouse Logs Explorer, the equivalent query is:

```sql
select timestamp, severity_text, event_message
from logs
where source = 'function_logs'
  and event_message like '%REQ-0123456789ABCDEF%'
order by timestamp desc
limit 20;
```

5. To review recent application-owned function failures without customer fields:

```sql
select timestamp, severity_text, event_message
from logs
where source = 'function_logs'
  and event_message like '%"event":"edge_function_failure"%'
order by timestamp desc
limit 100;
```

Replace the sample request id before running the first query. Supabase documents `function_logs` as internal function console output and notes that current Logs Explorer queries use the shared `logs` table with `source`, `event_message`, and structured `log_attributes`: https://supabase.com/docs/guides/telemetry/logs

### Production activation status

- Commit `524fdb4` is pushed to `origin/main`.
- `create-auth-user` version 5 and `send-project-notification` version 4 are active with JWT verification enabled.
- Non-mutating production checks verified request-id echoing, CORS exposure, and correlated generic `401` responses from both functions without changing application data or sending a Sentry event.
- The repository owner confirmed both synthetic validation ids appeared correctly in `function_logs` with only the approved structured fields.
- Netlify did not publish the first client build because the account had exhausted its build credits. After credits were replenished, commit `dfa03d2` retriggered the trusted production build successfully; direct checks confirmed the live entry and tracker bundles contain the request-correlation code.
- Milestone 2.2 is complete as of 2026-07-26.

## Milestone 2.3: health and alerting

Repository implementation passed its bounded checkpoint on 2026-07-26.

- `OBSERVABILITY_RUNBOOK.md` defines three production-only rules: an hourly-throttled first-seen/regressed email alert; a fatal-error metric monitor above 2 events in 5 minutes; and an unresolved-error metric monitor above 9 events in 15 minutes.
- The sustained threshold is report volume rather than a percentage failure rate because sessions, tracing, analytics, and stable user identifiers remain disabled.
- Only React render-boundary failures receive Sentry level `fatal`.
- Trusted Netlify/Sentry builds create a deploy record tied to the release commit, environment, context, and HTTPS deploy URL.
- The Project Tracker repository/Sentry owner is the primary responder. A backup responder and 24/7 coverage are not currently defined.
- All 126 focused regression tests passed, the production build transformed 678 modules successfully, and syntax/whitespace checks passed. Playwright, Capacitor sync, and APK builds were intentionally deferred at this checkpoint.
- Checkpoint commit `f9bdd79` is on `origin/main`. GitHub Actions run `30221519191` passed browser, Supabase authorization, audit, Capacitor, and Android APK jobs; Netlify completed the production deploy and the live URL returned HTTP 200.
- Releases `f9bdd79` and `7f17471` uploaded 104 source-map artifacts but their deploy records were skipped when both automatic and explicit commit association traversed an older object missing from Netlify's shallow checkout. Disable the optional bundler-plugin commit-association step so it cannot block finalization and deployment creation. The release version remains the full deploy commit SHA and its deployment record links to Netlify; the Sentry **Commits** tab remains optional and empty until repository integration can associate commits without local traversal.
- Production release `b7be67e` verified the correction on 2026-07-27: it is finalized, contains 104 source-map artifacts, and shows both **Last Deploy: production** and a production deploy entry. GitHub Actions run `30277446358` and the Netlify production deployment passed.
- All three production rules were activated on 2026-07-27. `Production - new or regressed issue` emails Aaron Engelman and throttles repeated actions to one hour. The two production metric monitors are assigned to Aaron and create high-priority issues at their documented thresholds; those issues inherit the project-wide production alert.
- Sentry's original all-environment `Send a notification for high priority issues` alert was disabled after it notified on both staging validation events and would have duplicated production monitor notifications.
- Milestone 2.3 is complete as of 2026-07-27.

## Later milestones

- **2.4 Native depth, if justified:** evaluate Firebase Crashlytics only if native Android crashes or ANRs remain invisible through the Capacitor path.
