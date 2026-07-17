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
