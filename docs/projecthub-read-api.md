# ProjectHub read-only API and MCP server

This service exposes an intentionally narrow executive-briefing projection of ProjectHub. It does not accept ProjectHub website sessions, Supabase user access tokens, cookies, or browser automation. It accepts only a dedicated service-account API key in the `Authorization: Bearer` header.

## Architecture and security boundary

- Runtime: Supabase Edge Function `projecthub-read-api`, matching the existing TypeScript/Supabase deployment model.
- Data source: allowlisted reads from projects, tasks, normalized schedule records, daily logs, RFIs, submittals, selections, and schedule delays.
- Authentication: revocable API key; only its SHA-256 hash is stored in `private.projecthub_api_clients`.
- Authorization: scopes and optional project IDs are returned by a `service_role`-only security-definer function. The Edge Function intersects every response with the service-account project scope.
- Read-only enforcement: REST accepts only `GET`/`HEAD`; MCP accepts only `POST` JSON-RPC and exposes six tools whose metadata marks them read-only. There is no route or tool for insert, update, delete, upload, storage, or administration.
- Operational writes: authentication rate buckets and security audit events are the only writes. They contain no API key, secret hash, search text, response body, or production record content.
- Privacy: response builders copy only stable IDs, timestamps, owner display text, status, priority, due date, summary, next action, and ProjectHub source URLs. Customer contact fields, addresses, attachments, storage paths, and internal auth data are excluded.

The official OpenAI MCP authentication guidance recommends OAuth 2.1 for interactive user authorization. This server-to-server briefing integration instead uses a scoped, revocable API key because ProjectHub has no OAuth authorization server and does not need user delegation. Add OAuth 2.1 later if interactive per-user access is required.

## Routes

The deployed base is:

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/projecthub-read-api
```

REST routes are beneath `/api/v1`:

- `GET /projects` — projects and current status
- `GET /tasks` — tasks; `status=overdue`, `due_today`, or `due_soon` adds date classification
- `GET /updates` — recent daily logs, RFIs, and submittals
- `GET /risks` — active blockers, schedule delays, and high/critical/urgent items
- `GET /milestones` — normalized project phases and steps
- `GET /attention` — overdue, risk, and pending-decision items
- `GET /search?q=...` — search the sanitized projection
- `GET /records/{type}/{id}` — individual-record lookup
- `GET /briefing` — compact daily briefing payload

Supported filters are `project`, `owner`, `status`, `priority`, `due_date`, and `updated_since`. Date-oriented routes also accept `date`, `timezone`, `lookback_days`, and `due_soon_days`. Pagination uses `limit` (1-100) and the returned opaque `next_cursor`.

All errors use this shape:

```json
{
  "error": { "code": "invalid_filter", "message": "date must use YYYY-MM-DD." },
  "request_id": "REQ-0123456789ABCDEF"
}
```

## MCP endpoint and tools

The Streamable HTTP MCP URL is:

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/projecthub-read-api/mcp
```

Configure the same bearer API key as the MCP authorization credential. The server is sessionless and supports `initialize`, `ping`, `tools/list`, and `tools/call`. Its tools are:

- `get_daily_briefing_items(date, timezone, lookback_period, project_filters?)`
- `list_overdue_tasks(date, project?, owner?, priority?, limit?)`
- `list_active_risks(project?, owner?, priority?, updated_since?, limit?)`
- `list_upcoming_milestones(date, days?, project?, owner?, status?, limit?)`
- `search_project_updates(query, project?, updated_since?, limit?)`
- `get_project_details(project_id)`

Briefing output is grouped, compact, and citation-ready. Each item includes a `citation.title` and a `citation.url` that links to ProjectHub.

## Environment variables

Edge Function runtime (Supabase provides the first two):

```text
SUPABASE_URL=https://<SUPABASE_PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Supabase server secret; never expose to a client>
PROJECTHUB_SITE_URL=https://projecthub.destinyhomesnj.com
```

API/MCP client runtime:

```text
PROJECTHUB_READ_API_KEY=<generated phro_... service-account key>
PROJECTHUB_READ_API_BASE_URL=https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/projecthub-read-api
PROJECTHUB_MCP_URL=https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/projecthub-read-api/mcp
```

`PROJECTHUB_READ_API_KEY` is not a Vite variable and must never be prefixed with `VITE_`.

## Local setup

1. Install Node dependencies with `npm install`.
2. Start the migrated Supabase stack with `supabase start`.
3. Run `node scripts/create-projecthub-api-key.mjs`. Optional flags: `--projects project-a,project-b`, `--requests-per-minute 60`, `--client-id ...`, and `--label ...`.
4. Save the displayed `phro_...` key in a local secret manager or untracked `.env.local`; run the displayed SQL as the local database administrator.
5. Serve the function with `supabase functions serve projecthub-read-api --no-verify-jwt`.
6. Run `npm run test:projecthub` and `npm run test:db`.

## Deployment

1. Review and back up production per the existing runbooks.
2. Link the Supabase CLI to the production project: `supabase link --project-ref <SUPABASE_PROJECT_REF>`.
3. Apply migrations with the existing controlled database deployment process (`supabase db push`).
4. Set `PROJECTHUB_SITE_URL` with `supabase secrets set PROJECTHUB_SITE_URL=https://projecthub.destinyhomesnj.com`. Supabase supplies its server URL and service-role secret.
5. Deploy with `supabase functions deploy projecthub-read-api --no-verify-jwt`. JWT verification is disabled only because the function performs its own dedicated API-key authentication.
6. Generate the production key offline with `node scripts/create-projecthub-api-key.mjs`, execute the generated SQL in the production SQL editor, and put the one-time key into the ChatGPT/Codex connection secret.
7. Test `/health`, an unauthorized request, an authorized request, `tools/list`, and one tool call. Confirm audit events and rate-limit headers.
8. Optionally reverse-proxy `/api/projecthub/*` and `/mcp/projecthub` from Netlify to the Edge Function. Keep the direct Supabase URL as the canonical MCP URL unless the proxy is configured to preserve `Authorization`, `POST`, and streaming-compatible headers.

Rotate a key by running the provisioning script again and applying its SQL. Revoke it immediately with:

```sql
update private.projecthub_api_clients
set enabled = false, revoked_at = now(), key_hash = null
where id = 'chatgpt-daily-briefing';
```

## Examples

```bash
curl -sS "$PROJECTHUB_READ_API_BASE_URL/api/v1/tasks?status=overdue&date=2026-09-01&priority=high&limit=25" \
  -H "Authorization: Bearer $PROJECTHUB_READ_API_KEY"
```

```json
{
  "data": {
    "items": [{
      "id": "task-123", "type": "task", "project_id": "project-9", "project_name": "Sample Project",
      "updated_at": "2026-08-31T18:05:00.000Z", "owner": "Project Manager", "status": "open",
      "priority": "high", "due_date": "2026-08-30", "summary": "Confirm inspection date",
      "next_action": "Call the inspector", "source_url": "https://projecthub.destinyhomesnj.com/?project=project-9&task=task-123"
    }],
    "page": { "limit": 25, "next_cursor": null, "has_more": false }
  }
}
```

```bash
curl -sS "$PROJECTHUB_READ_API_BASE_URL/api/v1/briefing?date=2026-09-01&timezone=America%2FNew_York&lookback_days=7" \
  -H "Authorization: Bearer $PROJECTHUB_READ_API_KEY"
```

```bash
curl -sS "$PROJECTHUB_MCP_URL" \
  -H "Authorization: Bearer $PROJECTHUB_READ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_daily_briefing_items","arguments":{"date":"2026-09-01","timezone":"America/New_York","lookback_period":7}}}'
```

## Derived semantics and limitations

- The existing model has no dedicated risk/blocker/milestone/executive-attention tables. Risks are conservatively derived from incomplete high/critical/urgent tasks, blocker/risk/delay language, schedule delays, rejected/revise workflow states, and similar status text. Milestones are schedule phases and steps with due/end dates. Executive attention combines overdue items, derived risks, and selections needing a decision.
- Project/task base tables have reliable creation timestamps but may lack a database-level `updated_at`; the projection prefers record JSON `updatedAt` and otherwise falls back to `created_at`.
- Each source read is capped at 5,000 records per invocation. Add indexed, database-native briefing views or RPC pagination before the dataset approaches that size.
- Rate limits use database minute buckets, but this is not a DDoS service. Add an API gateway/WAF, IP allowlisting where feasible, alerting, retention jobs for audit/rate tables, and secret rotation policy.
- Static API keys identify the service account, not an individual ChatGPT user. OAuth 2.1 with protected-resource metadata is recommended if future access becomes interactive or user-specific.
- Source URLs use query parameters already understood as navigation hints by ProjectHub; verify deep-link behavior in production and add explicit record routes if stronger citations are needed.
