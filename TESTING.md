# Automated testing

Project Tracker uses three bounded test layers:

- `npm test` runs fast behavioral and source-level regression checks.
- `npm run test:e2e` runs Playwright journeys against the real Vite app with deterministic, in-process Supabase API responses. These tests never use production accounts or data.
- `npm run test:db` runs pgTAP authorization tests against a started local Supabase stack.

## Browser tests

Install Chromium once, then run the suite:

```powershell
npx playwright install chromium
npm run test:e2e
```

Failed runs retain a Playwright trace and screenshot under `test-results/`. Open a trace with:

```powershell
npx playwright show-trace path\to\trace.zip
```

## Supabase authorization tests

Docker Desktop must be running because the Supabase CLI starts an isolated local stack:

```powershell
supabase start
npm run test:db
supabase stop
```

The pgTAP files use transactions and roll back their fixtures. Do not pass `--linked`; authorization tests are designed for the local migrated database, not production.
