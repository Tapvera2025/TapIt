# Social Media Manager validation — October 14, 2026

Implemented on the existing Archi checkout. Existing local Dockerfile changes and unrelated untracked files were preserved. No social app credentials were added and no real social posts were published.

- TypeScript typecheck, server build and Vite client build passed. Vite reports the existing large-bundle warning.
- Lint passed with zero errors; 66 existing warnings remain. The social module's focused lint has no warnings or errors.
- Authorization extraction is synchronized at 200 actions and 588 bindings. Normal CI passes all 17 checks and reports four existing phased gaps; strict whole-CRM release readiness is not claimed.
- Full default regression suite: 2,044 passed, 421 skipped. Many PostgreSQL integration suites are opt-in; they are not counted as executed by that run.
- Dedicated social suite against isolated PostgreSQL 18 through the restricted runtime role: 48 passed, including 12 HTTP/database workflow tests. Provider fetch and object storage are mocked. Tested tenant/client isolation, permission denial, uploads, expired/revoked tokens, approvals and self-approval denial, durable schedules, competing claims, interruption uncertainty, partial outcomes, safe retries, OAuth browser cookies/PKCE/replay/expiry, explicit account selection, reconnect IDs, and destination-specific content/media.
- Desktop 1440×1000 and mobile 390×844 browser fixtures: overview, accounts, monthly calendar, analytics empty states, settings and composer opened; draft save succeeded; no page errors or document overflow. Screenshots explicitly label fixture accounts. They do not prove live OAuth/publishing.
- Local Compose migrate/server/client images rebuilt successfully. Social migrations 0091–0093 applied; server, PostgreSQL, Redis and the existing MinIO are healthy. API health is successful, `/company/social` returns HTTP 200, and unauthenticated `/api/social/providers` returns HTTP 401.
- Live local schema check: all 13 social tables have ENABLE and FORCE RLS; `tapcrm_app` has `rolbypassrls=false`.
- Live provider readiness check: Facebook, Instagram, LinkedIn, Google Business Profile and YouTube each report `setup_required`. Credentials/app approvals and dedicated-account live validation remain necessary.

The temporary Vite QA server and isolated PostgreSQL test container were stopped after validation. The running CRM remains available.

Screenshots: [desktop composer](desktop-composer.png), [desktop calendar](desktop-calendar.png), [mobile composer controls and preview](mobile-composer-bottom.png), [mobile accounts](mobile-accounts.png).

See [setup and operations](../../setup/social-media.md) and [official platform setup](../../setup/social-platforms.md) for configuration, permission grants, testing and limitations.
