# Project Tracker handoff

Updated: 2026-07-17

## Working copy

- Use `C:\Dev\Project Tracker` for Project Tracker work. Do not use the archived OneDrive copy.
- Branch: `main`
- The working tree now contains the uncommitted Takeoff integration milestone described below.
- Recent commits:
  - `5994a9e` Trigger production deployment
  - `6e94084` Prevent startup splash from hanging
  - `d9d0e1c` Add Home dashboard and weather forecast
  - `dbc9809` Normalize tracker data and authorization

## Current priority: Takeoff integration

The original Takeoff source used for the import is located at:

`C:\Users\aaron\OneDrive\Documents\Takeoff App`

Treat that folder as a preserved reference copy. The active integrated source is now `C:\Dev\Project Tracker\src\features\takeoff`; keep all further Project Tracker and Takeoff integration work in the `C:\Dev` working copy.

### Verified Takeoff findings

- React 18 and Vite 5 make it compatible with Project Tracker's frontend approach.
- `src/App.jsx` is a relatively small shell around an imperative editor in `src/lib/takeoffApp.js`.
- The editor supports PDF rendering, pages, scale calibration, length/area/count measurements, markups, undo/redo, totals, CSV export, and saved takeoff projects.
- Persistence is handled by `src/services/takeoffData.js` using large JSON snapshots plus PDF objects in Supabase Storage.
- Takeoff and Project Tracker currently point to different Supabase projects.
- Takeoff's source files are untracked in its Git working tree and no remote was found during the assessment.
- Takeoff RLS and storage policies currently permit public access through the anonymous role. Secure these before exposing Takeoff through Project Tracker.

### Repository decision

- The user chose to import Takeoff directly into `C:\Dev\Project Tracker` rather than keep a standalone `C:\Dev\Takeoff App` repository.
- The imported feature is under `src/features/takeoff`.
- The original source at `C:\Users\aaron\OneDrive\Documents\Takeoff App` was copied from but not modified, moved, or deleted.

### Implemented milestone: secure project-level editor boundary

- Added a lazy-loaded **Takeoff** tab to each Project detail workspace.
- Imported and CSS-scoped the existing PDF editor so its generic styles do not affect Project Tracker.
- Added project-specific autosave/session keys and editor teardown so switching projects or tabs does not leak state or document listeners.
- Added review-mode protection for users without edit access.
- Added PDF.js to Project Tracker; the release now uses `pdfjs-dist@4.10.38` with ESM imports after CI identified the older 3.x line's malicious-PDF execution advisory.
- Replaced the old anonymous Takeoff Supabase adapter with `src/features/takeoff/services/projectTakeoffData.js`, which uses Project Tracker's current authenticated session.
- Added `supabase/migrations/20260717060000_add_project_takeoffs.sql` with:
  - project-scoped `project_takeoffs` snapshot records;
  - optimistic version checks in the client adapter;
  - audit events for takeoff inserts, updates, and deletes;
  - a private `takeoff-files` bucket with project-view/edit RLS policies.
- Added focused regression coverage for lazy loading, authenticated project scoping, cleanup, and RLS.
- Verification completed:
  - `npm run build` passes;
  - `npm test` passes with 103 tests;
  - `npm audit --omit=dev` reports zero production vulnerabilities after the PDF.js upgrade;
  - `node --check` passes for the imported editor and new data service;
  - `git diff --check` passes.
- Browser verification reached the local sign-in screen, but the isolated test browser had no Project Tracker session and its Supabase refresh timed out. The authenticated project-tab flow still needs a live-session smoke test after the migration is applied.

### Next Takeoff steps

1. Apply `20260717060000_add_project_takeoffs.sql` to the Project Tracker Supabase project.
2. With an authenticated test user, smoke-test opening a project, loading the Takeoff tab, uploading a PDF, saving, reopening, renaming, and deleting a takeoff.
3. Confirm mappings between legacy Takeoff records/PDFs and Project Tracker project IDs before importing existing data.
4. After the compatibility milestone is stable, normalize sheets, measurements, and markups out of the versioned snapshot into dedicated tables.

### Implemented milestone: Project Files picker and collapsible Takeoff sidebars

- Takeoff can now open a PDF directly from the current project's **Files** collection without exposing cross-project records.
- The picker searches PDF names and folders, supports authenticated Supabase Storage files and legacy inline files, and reports download errors without closing the picker.
- Project Files are converted to a browser `File` and passed through Takeoff's existing PDF loader; Takeoff's independent source-PDF save behavior remains unchanged so a saved takeoff does not break if the original Project File is removed.
- Uploading or selecting a replacement PDF now warns before discarding dirty Takeoff work.
- The Sheets and Takeoff sidebars have accessible collapse controls. Preferences persist locally, desktop uses slim reopen rails, and Android/mobile uses compact expandable sections with Takeoff controls initially collapsed on first use.
- Read-only users can still collapse panels but cannot start a new takeoff from Upload PDF or Project Files.
- Focused regression coverage now verifies current-project PDF filtering and the picker/sidebar integration. `npm test` passes with 107 tests; the production build, Capacitor Android sync, and Gradle `assembleDebug` all pass.
- Authenticated browser smoke testing passed in **105 Destiny Way**: the picker listed/search-filtered current-project PDFs, downloaded and rendered the five-page `Door Emporium 105 DESTINY.pdf`, both sidebars collapsed and expanded correctly, and the stacked 412 px Android layout kept each section full-width and reachable. No takeoff was saved and no server-side project data was changed.
- UI cleanup follow-up: the embedded editor now uses container-aware header, toolbar, sidebar, and phone layouts instead of relying only on browser breakpoints. The document name is separated from file actions, labels are shorter, tool controls wrap without horizontal overflow, Count/Markup options have clear headings, and 681–899 px workspaces keep only one sidebar open at a time so the drawing remains usable.
- Live checks passed at the 764 px embedded project width and a 412 px Android viewport with no toolbar overflow. Commit-checkpoint verification passed with 107 regression tests, the production build, Capacitor Android sync, and Gradle `assembleDebug`.
- Deployment completed on 2026-07-17: commit `f558a0e` was pushed to `origin/main`, GitHub Actions run `29614788803` passed, Netlify completed the linked production deploy, and `https://projecthub.destinyhomesnj.com` returned HTTP 200 serving release asset `index-0h9hceO4.js`.
- Local follow-up on 2026-07-17 fixes Takeoff page arrows skipping a sheet. React development remounts had left element-level event listeners attached; Takeoff now owns all static listeners with an `AbortController` and aborts them during teardown. All 107 regression tests pass, and authenticated browser checks confirmed one click moves `Page 1 / 5` to `Page 2 / 5` and back to `Page 1 / 5`. This follow-up is not yet committed or deployed.
- Local Project Overview redesign on 2026-07-19 follows the supplied owner-summary reference: a project summary, large selected main image, project-specific live counts, compact weather rail, and a details/contact section. Home remains the existing daily portfolio dashboard. The main overview image is selected only from **Edit Project** using uploaded project photos; the Photos tab no longer changes the selection. Focused authenticated browser checks passed at desktop and 412 px widths with no horizontal overflow, and the Edit Project selector listed the project photos correctly. The earlier mistaken Home checkpoint passed 107 regression tests and `npm run build`; full tests/Android compilation remain deferred until commit. This batch is not yet committed or deployed.
- Project Overview refinement on 2026-07-19 removes weather, moves all project/contact/notes data into the left column, and shrinks the main image using `object-fit: contain` so the full photo is visible by default. **Edit Project** now includes **Crop image to fill**, persisted as `mainPhotoCrop`; enabling it switches the overview image to `object-fit: cover`. The caption beneath the main image has also been removed. Focused desktop and 412 px checks passed with no horizontal overflow. No full suite or Android build was run for this visual revision.
- Audit Trail reliability milestone on 2026-07-19 is applied to production through `20260719090000_compact_and_paginate_audit_events.sql`. Takeoff audit events now store only compact name/version/count summaries instead of full snapshots; existing Takeoff audit snapshots and inline binary fields in other audit JSON were compacted. Authenticated reads now use the project-scoped `get_audit_events` RPC with cursor pagination, Settings loads 50 raw events at a time with **Load older changes**, and Home requests at most 100 events from today/yesterday. The production web build passes, and an authenticated local smoke test loaded 107 expanded Audit Trail entries without the former statement-timeout alert or browser warnings. The full regression suite and Android build remain deferred until the commit checkpoint.
- Exception-driven Home milestone on 2026-07-19 replaces the all-open-work dashboard with operational project health, **Needs attention** groups for overdue tasks/inspections, genuinely blocked or delayed schedule steps, and unassigned tasks, plus capped Today and Next 7 Days task/inspection/schedule lists. Editors can add a lightweight task or mark a task complete directly from Home; every longer list drills into the relevant workspace. Weather visibility is stored per app user and hidden weather is not fetched. Project rail and overview cards now derive health from real overdue/blocked work rather than project status alone. Focused Home logic checks and the production web build pass; authenticated desktop and 412 px checks showed the new sections, working pagination/drill-through controls, no horizontal overflow, and no browser warnings. No task/project data was changed during browser verification. The full regression suite and Android build remain deferred until the commit checkpoint.
- Actionable Project Overview milestone on 2026-07-19 turns every live count into a direct project-tab link and adds the next upcoming schedule milestone, the highest-priority overdue/delayed item, latest audit activity, customer call/email actions, missing-information warnings, the assigned project manager/users, and a three-photo recent strip. **Edit Project** now exposes the already-supported project manager field. The approved three-column overview, contain/crop main-photo behavior, and empty space beneath the main image remain intact. Focused regression assertions were added; `npm run build` passes. Authenticated checks with production-like data passed at 1440 px and 412 px: the real overdue task label and upcoming milestone rendered correctly, the mobile view stayed single-column without horizontal overflow, and no browser warnings/errors appeared. No server data was changed. The full regression suite and Android build remain deferred until the commit checkpoint.
- Sectioned Settings milestone on 2026-07-19 divides administration into **Scheduling**, **Calendar & holidays**, **Inspections**, **Notifications**, **Users & access**, **Audit history**, **Display preferences**, and **System status**. Desktop uses an accessible keyboard-navigable section tab list; widths at or below 720 px use one full-width section selector and render only the chosen panel. Existing drafts and permission behavior remain intact when switching sections. Audit events are no longer requested until Audit history is opened. Web users receive an explanation that Android notification preferences are device-specific, while System status shows the active data source, platform, loaded record counts, and current user. Focused regression coverage was added and `npm run build` passes. Authenticated desktop and 412 px smoke checks verified section switching, the deferred audit load, live system counts, no horizontal overflow, and no browser warnings/errors. No settings or server data was changed. The full regression suite and Android build remain deferred until the commit checkpoint.
- Small-screen Users & access refinement on 2026-07-19 moves each user card's Save, Invite, and Remove icon controls after Project access and keeps all three on one horizontal row at widths up to 720 px. Desktop retains the compact controls beside the user identity fields. `npm run build` and `git diff --check` pass; a read-only authenticated 412 px check confirmed the actions were below access, shared one line, and caused no horizontal overflow or browser warnings. No user or access data was changed.
- Construction workflows phase 1 on 2026-07-19 adds project-level **Daily Logs** and **Change Orders** tabs. Daily logs capture local job date, weather/site conditions, subcontractor work, deliveries, visitors, delays, issues/safety, and notes. Change orders track an automatic `CO-###` number, status, scope, reason, notes, cost impact, schedule impact, response due date, and approval date. The new `20260719180000_add_daily_logs_and_change_orders.sql` migration provides project-scoped tables, authorization-aware RLS, optimistic version checks, and compact audit events; it has not yet been applied to production. Until it is applied, the UI clearly uses device-only draft storage rather than failing. The production web build passes, and authenticated desktop/412 px smoke tests verified both empty states and create forms with no horizontal overflow; the daily-log default uses the local calendar date. No workflow record was saved during testing. The full regression suite and Android build remain deferred until the commit checkpoint. Remaining recommendation #8 phases are RFIs/submittals, budget/commitments, customer/subcontractor portal workflows, and warranty/closeout; photos/attachments for these first two workflows are also a follow-up.
- Daily Log subcontractor-work follow-up on 2026-07-20 replaces unstructured subcontractor entry with repeatable People-backed subcontractor selections. Each selected subcontractor has its own work-performed notes and multiple work photos. New photos upload to authenticated project storage under `daily-log-photos`; the log stores only project-scoped metadata, renders thumbnails after saving, and cleans up removed photos after a successful update or deletion. Focused assertions were added, `npm run build` and `git diff --check` pass, and authenticated desktop/412 px checks confirmed the real People subcontractor list, contractor selection, photo picker, responsive stacking, and no horizontal overflow. No log or photo was saved during browser verification. Full tests and Android compilation remain deferred until the commit checkpoint.
- Inline Daily Log subcontractor creation on 2026-07-20 adds **New subcontractor** beside each People selector. It opens the existing full subcontractor form and persists through the same `createPerson` path used by People; the created record is added globally and automatically selected in the originating work entry. `npm run build` and `git diff --check` pass. Authenticated desktop and 412 px checks verified the form, its complete field set, cancellation, and no horizontal overflow without creating a People record. Full tests and Android compilation remain deferred until the commit checkpoint.
- Daily Log field consolidation on 2026-07-20 removes the general **Work performed** and **Additional labor notes** inputs in favor of one full-width **Notes** field. Subcontractor-specific work-performed fields remain. Per user direction, legacy general work/labor values are ignored rather than migrated. `npm run build` and `git diff --check` pass, and an authenticated create-form check confirmed the simplified field set without saving a record. Full tests and Android compilation remain deferred until the commit checkpoint.
- Daily Log subcontractor labels now always prefer the People company name, with the contact person secondary in parentheses (for example, **Gluck Plumbing (Simcha Malach)**). The company-first formatter is used in selectors, saved snapshots, inline-created automatic selections, and saved-log summaries. `npm run build` and `git diff --check` pass; authenticated inspection confirmed company-first options and summary labels without saving a record. Full tests and Android compilation remain deferred until the commit checkpoint.
- New Daily Logs now request current conditions through the existing Open-Meteo/device-location path and prefill the editable weather field with condition, temperature, feels-like temperature, wind, and precipitation when applicable. A 15-minute cache limits repeat current-condition requests; unavailable location/weather leaves the field blank without blocking the log. The subcontractor section is now a true full-width, top-aligned grid row with max-content row sizing, so adding subcontractors no longer stretches Deliveries, Visitors, or other neighboring fields. `npm run build` and `git diff --check` pass. Authenticated desktop/412 px checks confirmed three added subcontractor rows left the other field heights unchanged and the phone layout had no horizontal overflow; the isolated browser had no usable location, so live weather population remains dependent on the device's existing location access. Full tests and Android compilation remain deferred until the commit checkpoint.
- Full regression checkpoint on 2026-07-20 passes all 110 tests after the Daily Log subcontractor, photo, inline People creation, notes consolidation, company-first labels, current-weather prefill, and stable-grid changes. This supersedes the per-revision notes that the full suite was deferred. Android compilation has not been rerun since these Daily Log follow-ups.
- Construction workflows phase 2 on 2026-07-20 adds one project-level **RFIs & Submittals** tab with count-backed RFI/Submittal views. RFIs track automatic `RFI-###` numbering, status, subject, question/response, a People-backed responsible person, due/response dates, cost and schedule impacts, and notes. Submittals track `SUB-###`, specification section, company-first People subcontractor, reviewer, description, review/submission/decision dates, reviewer notes, and construction review statuses including approved-as-noted and revise/resubmit. Migration `20260720140000_add_rfis_and_submittals.sql` adds project-scoped normalized tables, RLS, optimistic versions, unique project numbering, and compact audit events; it is not yet applied. Missing tables fall back visibly to device-only drafts. `npm run build` and `git diff --check` pass. Authenticated desktop/412 px checks verified both create forms, real People options, single-column phone forms, and no horizontal overflow without saving records. The newly added focused regression assertions have not yet been included in a full-suite run. Remaining #8 phases are budget/commitments, customer/subcontractor portal workflows, and warranty/closeout; RFI/submittal attachments are a follow-up.
- Construction workflows phase 3 on 2026-07-20 adds a project-level **Budget & Commitments** tab with count-backed Budget/Commitments views and live current-budget, committed, paid, uncommitted, forecast, and projected-variance totals. Budget items track codes, category, status, original budget, approved changes, forecast, actual cost, and notes. Commitments track `COM-###`, company-first People vendors, linked budget codes, scope, status, committed/paid amounts, retainage, dates, and notes. Migration `20260720170000_add_budget_and_commitments.sql` adds project-scoped normalized tables, RLS, optimistic versions, unique project numbering, and compact audit events; it is not yet applied. Missing tables fall back visibly to device-only drafts. `npm run build` and `git diff --check` pass. Authenticated desktop/412 px checks verified both create forms, real company options, single-column phone forms, and no horizontal overflow without saving records. The new focused regression assertion has not yet been included in a full-suite run, and the APK was not rebuilt. Remaining recommendation #8 phases are customer/subcontractor portal workflows and warranty/closeout; workflow attachments/invoices remain follow-ups.
- Full regression and Android checkpoint on 2026-07-20 passes all **112 regression tests** after the RFI/Submittal and Budget/Commitments additions. `npm run android:sync` completed with a successful 300-module production build and Capacitor sync, and Gradle `assembleDebug` completed successfully. The current debug APK is `android/app/build/outputs/apk/debug/app-debug.apk` (9,505,775 bytes, built 2026-07-20 1:00:19 PM local time). Gradle emitted deprecation and optimization warnings but no build errors.
- Construction workflows phase 4 on 2026-07-20 adds a project-level **Portal** workspace. Staff can publish numbered project updates, information requests, and approval requests to customers, subcontractors, or both audiences, with due dates and lifecycle statuses. Customer/Subcontractor accounts default to the Portal and internal project tabs are hidden; staff retain the full workspace. Portal users respond or approve/decline through the restricted `respond_to_project_portal_item` RPC, which verifies their assigned project, role, audience, record version, and response state while leaving staff-authored fields unavailable to the response action. Migration `20260720190000_add_project_portal_workflows.sql` adds the project-scoped table, audience-aware RLS, optimistic versions, compact audits, and the response RPC; it is not yet applied. Missing schema falls back visibly to device-only drafts. `npm run build` passes with 301 modules, and authenticated staff checks verified the create form and 412 px single-column layout without horizontal overflow or saved data. Focused regression assertions were added, but the full suite and APK were not rerun after this phase. Do **not** activate external portal accounts yet: the legacy initial app data load still reads broader assigned-project data before the portal-only UI renders, so a portal-specific server read model/RPC and tighter legacy-table RLS are required for production external-user isolation. Remaining recommendation #8 work is that portal data-isolation hardening followed by warranty/closeout workflows.
- Portal data-isolation hardening on 2026-07-20 adds `20260720200000_harden_project_portal_reads.sql`. The client now requests only the current app-user profile first; Customer/Subcontractor accounts load a minimal security-definer portal bootstrap containing their own profile and assigned project id/name/address/status/dates, with empty tasks and People collections. They no longer enter the normal tracker loader, Home is removed from their allowed top-level tabs, and Project Detail skips audit loading. Restrictive RLS policies deny those roles direct reads from internal legacy/normalized tracker tables and Storage, while `project_portal_items` remains audience-filtered through its own policy. Staff continue through the existing full loader; an authenticated admin smoke test passed while the new RPC is unapplied by falling back only when the profile function is absent. `npm run build` passes with 301 modules and `git diff --check` passes. Focused regression assertions cover the safe bootstrap and restrictive policies; the full suite and APK remain deferred. Both portal migrations are still unapplied, so external accounts must remain inactive until they are applied together and a real assigned Customer/Subcontractor account verifies project listing, audience filtering, responding, approval/decline, and direct internal-table denial. After that validation, recommendation #8 can proceed to warranty/closeout.
- Full regression checkpoint after portal workflows and data-isolation hardening on 2026-07-20 passes all **113 regression tests**. This supersedes the phase notes that the portal assertions had not yet been included in a full-suite run. The Android APK has not been rebuilt since the preceding 112-test checkpoint.
- Login-invite reliability follow-up on 2026-07-20 routes `inviteAuthUser` through the shared authenticated Supabase request path instead of raw `fetch`. Invite requests now require a live signed-in token, refresh an expired JWT and retry through the existing session logic, use a 20-second labeled timeout, and replace the browser's unhelpful `Failed to fetch` with an actionable connection/session message. The deployed `create-auth-user` Edge Function is ACTIVE at version 4 and its production CORS preflight returns HTTP 200 with the required authorization/apikey/content-type headers. `npm run build` passes with 301 modules. A focused regression assertion was added; the full suite was last run immediately before this small client fix (113 passing), and the APK was not rebuilt.

### Original recommended implementation

1. With user approval, put the active Takeoff source under Git in a non-OneDrive `C:\Dev` location.
2. Add a lazy-loaded project-level **Takeoff** tab in Project Tracker. Avoid an iframe.
3. Initially adapt the existing editor behind a React feature boundary so existing behavior is preserved.
4. Use the Project Tracker Supabase session, `app_users`, and `project_user_access` authorization.
5. Associate every takeoff with a Project Tracker project and reuse project file/storage handling for PDFs where practical.
6. Replace the permissive Takeoff database/storage policies before migrating data.
7. Normalize into versioned records such as `project_takeoffs`, `takeoff_sheets`, `takeoff_measurements`, and `takeoff_markups`, with optimistic concurrency and audit events.
8. Import existing `takeoff_projects.data` snapshots and PDFs after project mappings are confirmed.
9. Preserve full desktop editing initially; use a simplified mobile review/summary experience until touch editing is designed.

## Deployment milestone: integrated release live

- Commit `26d55f2` integrates Takeoff, Android file opening, project main photos, and the Android notification work.
- Commit `7110621` upgrades PDF.js to the secure 4.10.38 release after the first production audit rejected the older dependency.
- Both commits were pushed to `origin/main`; GitHub Actions run `29572735201` passed the web build/tests/audit and Android debug APK jobs.
- Netlify reported the production deployment complete on 2026-07-17 at `https://projecthub.destinyhomesnj.com`.
- A direct production check returned HTTP 200 and served the verified build assets `index-Ca3bcqlD.js` and `index-CEyEcB_J.css`.
- The Takeoff and Android push migrations plus the notification Edge Function were deployed during the FCM activation milestone below.

## Android artifact

- Full checkpoint verification on 2026-07-20 passed: all 110 regression tests, the production Vite build, Capacitor Android sync, Gradle `assembleDebug`, and `git diff --check`. The freshly compiled APK is `C:\Dev\Project Tracker\android\app\build\outputs\apk\debug\app-debug.apk` (9,505,373 bytes, built July 20, 2026 at 10:00 AM). The older branded `Destiny-Project-Hub-1.2.apk` in the same directory was not regenerated and should not be treated as the current build.

### Android notification milestone

- Replaced the single high/public reminder channel with three private channels:
  - **Due soon** and **Inspections** use normal importance;
  - **Overdue summary** uses quiet/low importance without vibration.
- Matching reminders are condensed into per-project digests while single tasks retain direct actions.
- Local reminders support **Open**, **Snooze until tomorrow**, and capability-checked **Mark done** actions.
- Notification taps deep-link to the permitted project/task/calendar context, reminders resync when the app becomes visible, and denied users can open Android's notification settings directly.
- Notification preferences are available from the Android account menu for every signed-in role, in addition to the Admin Settings page.
- Added explicit Android 13+ notification permission and retained inexact scheduling when Android does not grant exact-alarm access.
- Added the Capacitor push-notifications integration and configuration-safe registration. Android CI now builds with `VITE_FIREBASE_PUSH_ENABLED=true`.
- Added `20260717070000_add_android_push_notifications.sql` with account-bound device tokens, RLS, secure registration RPCs, and idempotent delivery event records.
- Added `send-project-notification`, a Supabase Edge Function that verifies the editor, filters recipients by project access, sends private normal-priority FCM messages, and removes invalid tokens.
- Task creation/updates/assignments and inspection changes now enqueue live notification delivery without blocking the saved project mutation.
- Live FCM activation completed on 2026-07-17:
  1. Firebase Android client `com.destinyhomes.projecthub` was configured and its `google-services.json` validated;
  2. `FIREBASE_SERVICE_ACCOUNT_JSON` was stored as a Supabase Edge Function secret;
  3. migrations `20260717060000_add_project_takeoffs.sql` and `20260717070000_add_android_push_notifications.sql` were applied to production;
  4. `send-project-notification` was deployed and verified `ACTIVE` at version 1;
  5. a Firebase-enabled Capacitor sync and Android debug build passed, including Gradle's `processDebugGoogleServices` task;
  6. GitHub Actions uses the `GOOGLE_SERVICES_JSON` repository secret and enables `VITE_FIREBASE_PUSH_ENABLED=true` for Android builds;
  7. the token RPC client sends JSON content types explicitly, fixing the `PGRST202` unnamed-text-parameter error found during device activation;
  8. physical-device validation passed on a Samsung `SM-X218U`: notification permission was granted, the FCM token registered in `device_push_tokens`, Firebase accepted a smoke-test message, and Android posted it privately on `project-tasks-v2`.
- Production project events intentionally exclude the user who made the change. Validate the multi-user recipient path by making a project change from a different authorized account than the account signed in on the receiving device.
- Verification completed: 106 regression tests, production build, Capacitor Android sync, `assembleDebug`, and `git diff --check` pass.

### Project main photo milestone

- Project Photos now allows editors to select exactly one uploaded photo as the project's main photo.
- The selected card is visibly badged, replacement preserves the selection, and deleting it clears the reference with undo-aware restoration.
- The Project Overview tab displays the selected photo as a responsive hero image and downloads only that photo for its preview.
- Regression coverage increased to 104 passing tests; the production build, Android sync, and debug APK build pass.

The branded debug APK was rebuilt on 2026-07-16 and written to:

`C:\Dev\Project Tracker\android\app\build\outputs\apk\debug\Destiny-Project-Hub-1.2.apk`

This build includes the current Takeoff integration, project main photos, the Android download action menu with **Open file**, **Save to Downloads**, and **Share**, and the local notification improvements above. `npm test`, the production web build, Capacitor Android sync, and `assembleDebug` all passed. The native opener uses Android `ACTION_VIEW` with the existing `FileProvider` and reports a clear error when no installed app supports the file type.

## Efficient continuation

- Keep new requests bounded and batch related UI changes.
- Build/test once per coherent batch rather than after each small visual adjustment.
- Deploy only after a batch is accepted.
- Update this handoff when a milestone changes the current priority or deployment state.
