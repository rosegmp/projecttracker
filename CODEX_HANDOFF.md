# Project Tracker handoff

Updated: 2026-07-16

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
- Added `pdfjs-dist@3.11.174` to Project Tracker.
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
  - `node --check` passes for the imported editor and new data service;
  - `git diff --check` passes.
- Browser verification reached the local sign-in screen, but the isolated test browser had no Project Tracker session and its Supabase refresh timed out. The authenticated project-tab flow still needs a live-session smoke test after the migration is applied.

### Next Takeoff steps

1. Review and commit the current milestone.
2. Apply `20260717060000_add_project_takeoffs.sql` to the Project Tracker Supabase project.
3. With an authenticated test user, smoke-test opening a project, loading the Takeoff tab, uploading a PDF, saving, reopening, renaming, and deleting a takeoff.
4. Confirm mappings between legacy Takeoff records/PDFs and Project Tracker project IDs before importing existing data.
5. After the compatibility milestone is stable, normalize sheets, measurements, and markups out of the versioned snapshot into dedicated tables.

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

## Deployment state to verify

- Commit `6e94084` fixes a startup splash that could hang by adding timeouts around authentication-related fetches.
- Commit `5994a9e` was pushed to trigger the Netlify Git deployment.
- At the last verification, the production site was still serving the older asset bundle, and direct Netlify CLI deployment returned `Forbidden`.
- The user had the Netlify email-login page open. Authenticate Netlify, then verify the deployed commit/assets before assuming the startup fix is live.

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
- Added the Capacitor push-notifications integration and configuration-safe registration. Live push remains disabled unless `VITE_FIREBASE_PUSH_ENABLED=true` is present in the Android build.
- Added `20260717070000_add_android_push_notifications.sql` with account-bound device tokens, RLS, secure registration RPCs, and idempotent delivery event records.
- Added `send-project-notification`, a Supabase Edge Function that verifies the editor, filters recipients by project access, sends private normal-priority FCM messages, and removes invalid tokens.
- Task creation/updates/assignments and inspection changes now enqueue live notification delivery without blocking the saved project mutation.
- Live FCM activation still requires:
  1. Firebase `google-services.json` at `android/app/google-services.json`;
  2. `FIREBASE_SERVICE_ACCOUNT_JSON` in Supabase Edge Function secrets;
  3. applying migration `20260717070000_add_android_push_notifications.sql`;
  4. deploying `send-project-notification`;
  5. building with `VITE_FIREBASE_PUSH_ENABLED=true`.
- The current Supabase CLI session is not authenticated (`functions list` returned 401), and remote migration inspection also returned a database handler exit, so no remote migration/function deployment was attempted.
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
