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

- Steps 1–7 are implemented locally and verified at the commit checkpoint.
- The privacy contract is approved, and the Sentry project plus Netlify runtime/build variables are configured.
- All 125 regression tests, all 9 Playwright journeys, the production build, dependency audit, Capacitor sync, Android debug build, syntax checks, and `git diff --check` pass.
- No event has been sent. Step 8 remains the final pre-production gate: use a Netlify Deploy Preview with `VITE_SENTRY_ENVIRONMENT=staging`, send one intentional sanitized exception, inspect the complete event against this contract, remove the trigger, and obtain final approval before pushing to `main`.

## External prerequisites and approval boundary

Milestone 2.1 activation required the repository owner to:

1. create or select a Sentry organization and Project Tracker project;
2. accept the provider's plan, retention, data-processing, and access settings;
3. supply the web/Capacitor DSN through Netlify and local staging configuration;
4. create a least-privilege source-map upload token and store it as a GitHub/Netlify secret;
5. approve the privacy contract above.

These prerequisites are complete for Sentry and Netlify. The SDK is installed locally but remains unpushed; no test event, production telemetry, Supabase log drain, Crashlytics, Analytics, replay, or tracing is active. Production activation remains blocked on the staging-event inspection and explicit final review.

## Later milestones

- **2.2 Backend correlation:** add random request ids to privileged Edge Function responses and privacy-safe structured failure logs; document Supabase Logs Explorer queries. Do not enable a paid log drain initially.
- **2.3 Health and alerting:** alert only on new regressions, repeated fatal errors, and sustained failure-rate thresholds; link releases to commits and deployment status.
- **2.4 Native depth, if justified:** evaluate Firebase Crashlytics only if native Android crashes or ANRs remain invisible through the Capacitor path.
