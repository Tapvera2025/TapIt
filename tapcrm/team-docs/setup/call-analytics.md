# Call Analytics (JustCall and Aircall)

Sales → **Calls** shows every call a company makes and takes on JustCall or Aircall, attributed to CRM employees, with an employee view, a team view and a searchable call log. A Super Admin connects the platform with an API key under Sales → **Call Integrations**. No marketplace app or OAuth client is needed; each company uses its own key.

Code: `packages/server/src/modules/sales/telephony/` (server) and `packages/client/src/company/sales/calls/` (client). Migration: `0131_telephony_call_analytics.sql`.

## Enable and configure

1. Generate the credentials key once and set it on the server:

   ```sh
   openssl rand -hex 32   # → TELEPHONY_CREDENTIALS_KEY in .env
   ```

   API keys that companies enter are encrypted with AES-256-GCM under this key, bound to the company, the connection and the platform (a ciphertext copied to another row does not decrypt). Back it up as a secret. Changing it makes saved keys unreadable: the connection shows "The saved API key could not be read" and an admin re-enters the key. Without the key, Call Integrations explains that setup is pending and stores nothing. `docker-compose.yml` passes the variable to the server.
2. Run `npm run migrate`. `0131_telephony_call_analytics.sql`:
   - registers the **Call Analytics** module (key `telephony`, Sales group in Master Admin) and three permissions;
   - adds four tenant tables with forced RLS: `telephony_connection`, `telephony_agent`, `telephony_call`, `telephony_sync_run` (the app role cannot delete from any of them);
   - enables Call Analytics for every company that already has Leads enabled, and gives the seeded Sales positions their default reach (below).
3. New companies get Call Analytics when the Sales group is enabled in Master Admin.
4. Restart the server so the job scheduler registers `telephony.sync-sweep`.

## Permissions

| Permission | What it allows | Default reach |
| --- | --- | --- |
| `telephony:view` | Calls, Team/My calls analytics, call log, call details | Sales Head: department · Team Lead: team · Supervisor: pool · Agent (and other base employees): own |
| `telephony:listen` | Play call recordings and voicemails. **Sensitive**: every play is written to the access audit. | Same as `telephony:view` |
| `telephony:manage` | Connect/replace keys, sync, pause, disconnect, match platform users | Super Admin only (it can be granted to a position on purpose) |

A call belongs to the employee its platform user is matched to; reach is evaluated on that employee's team, pool and department (`policy.ts`, resource `telephonyCall`). Calls from platform users that are not matched to an employee are visible to Super Admin only until someone matches the user.

## Connecting a platform

| | JustCall | Aircall |
| --- | --- | --- |
| Where the key is | Profile menu → **APIs and Webhooks** → API Key + API Secret | Dashboard → **Integrations & API → API Keys** → API ID + API token |
| Plan | Team plan or higher for API access | Any plan with API access |
| History available | Last 3 months (API limit) | As far back as chosen (up to 365 days) |
| Rate limit | 30–90 requests/min depending on plan | 120 requests/min per company |
| Auth sent | `Authorization: <key>:<secret>` | HTTP Basic `api_id:api_token` |

The key is verified with the platform before anything is saved (wrong keys return a clear 422). The first sync starts immediately; after that a sync runs every 15 minutes. **Sync now** queues an extra run. **Pause** stops syncing without deleting anything. **Disconnect** deletes the saved key and keeps the synced calls (their recordings can no longer be played until the platform is reconnected). One connection per platform per company.

## What is synced

- **Platform users** (JustCall `/v2.1/users`, Aircall `/v2/users` with `/v1/users` fallback): name, email, role, extension, numbers, groups/teams.
- **Calls** (JustCall `/v2.1/calls` with AI and queue data, Aircall `/v1/calls`): direction, normalized outcome (answered, missed, voicemail, abandoned, not answered, busy, failed), missed reason, start/answer/end, total, talk, ring, hold, queue-wait and wrap-up time, contact number/name/email, business line, notes/comments, disposition, tags, rating, JustCall AI summary, sentiment and call score, and platform extras (call path, IVR, queue callback, transfers, cost) in `metadata`.
- **Recordings are not stored.** Playback fetches a fresh recording through the CRM with the company's key (`GET /api/telephony/calls/:id/recording`), so access is checked and audited every time and the platform's link never reaches the browser.

Each run reads from the last high-water mark minus a 6-hour overlap, so notes, recordings and AI results that arrive after a call ends are picked up; calls are upserted by `(connection, platform call id)`, so re-reading is harmless. A run stops after 300 API requests or 4 minutes, records itself as *partly synced* and the next run continues from the newest call stored. 429 responses wait for the platform's reset header. Every run is listed in the connection's **History** (calls new/updated, API requests, errors).

## Matching platform users to employees

1. Automatic: the platform user's email equals the CRM employee's email (case-insensitive). Former employees match too, so their calls stay in history.
2. Manual: pick an employee for any platform user (personal emails, shared logins). Manual choices are never overridden by the email matcher.
3. **Not an employee**: shared lines, ring groups, bots. Their calls stay out of employee and team numbers.
4. **Match by email** returns a user to automatic matching; **Re-run email matching** redoes all automatic matches (manual choices stay).

If a platform user's email changes, an automatic match is dropped and redone on the next sync.

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/telephony/overview?from&to&employeeId&teamId&provider&direction` | `telephony:view` |
| GET | `/api/telephony/calls?…&outcome&search&unmatched&page&pageSize` | `telephony:view` |
| GET | `/api/telephony/calls/:id` | `telephony:view` |
| GET | `/api/telephony/calls/:id/recording` | `telephony:listen` |
| GET | `/api/telephony/employees` | `telephony:view` |
| GET/POST | `/api/telephony/connections` | `telephony:manage` |
| PATCH | `/api/telephony/connections/:id` | `telephony:manage` |
| POST | `/api/telephony/connections/:id/{test,sync,disconnect}` | `telephony:manage` |
| GET | `/api/telephony/connections/:id/runs` | `telephony:manage` |
| GET | `/api/telephony/agents`, `/api/telephony/employee-options` | `telephony:manage` |
| PUT | `/api/telephony/agents/:id/employee` | `telephony:manage` |
| POST | `/api/telephony/agents/rematch` | `telephony:manage` |

Dates are calendar days in the company's timezone; the default range is the last 30 days.

## Local testing

Outside production the platform base URLs can point at a mock server: `TELEPHONY_JUSTCALL_API_BASE` and `TELEPHONY_AIRCALL_API_BASE` (ignored when `NODE_ENV=production`). Unit tests cover the normalizers, pagination, rate limiting, host checks and encryption; `telephony.integration.test.ts` runs connect → sync → match → scope → recording → disconnect against PostgreSQL:

```sh
TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run telephony.integration
```

## Assigned imported leads

The **Assigned leads** tab (with `lead-imports:view`) matches calls to imported leads by phone number and shows whether each assignee called their leads after they were assigned. See [Lead Imports](lead-imports.md#call-tracking).

## Not included yet

- Real-time webhooks (calls currently arrive within 15 minutes, or on **Sync now**).
- Logging matched calls on every lead's timeline (imported leads are matched on the Assigned leads tab; the lead page lists calls with its number).
- Click-to-call from the CRM, SMS/WhatsApp history, Aircall conversation-intelligence transcripts.
- More than one account per platform per company.
