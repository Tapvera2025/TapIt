# SEO findings trend verification — 26 October 2026

The interrupted historical-trend feature is completed in the existing SEO Overview. It uses Chart.js and the tenant-scoped findings-trend endpoint. UTC calendar dates are serialized as date strings, all five severities are zero-filled, finding closure persists its timestamp, and the site resource loader preserves the DAL's camelCase organization ID.

## Verified

- Full Vitest suite: 2,269 passed, 436 skipped, zero failures; run outside the filesystem/network sandbox because HTTP tests require local listeners.
- PostgreSQL 18 integration: all 11 SEO integration tests passed against a separate, freshly migrated QA database using the restricted `tapcrm_app` role. Coverage includes UTC boundaries, day-range/zero buckets, cross-tenant/site isolation, closure, repeated closure, reopening, and current counts.
- Client production build and server TypeScript build passed.
- Registry check passed: 226 actions, 643 bindings.
- Targeted ESLint passed for trend/chart/model, API, workspace, contract, service, routes, validators, jobs, policy, and regression tests. Existing workspace hook dependency warnings remain.
- Playwright chart fixtures passed at 1440px and 390px: five stacked datasets, tooltip totals, keyboard severity toggles, UTC dates in a Los Angeles browser, retained data after a failed refresh, retry, zero history, stale-site protection, dark theme, and no page overflow. Screenshots were visually inspected.
- Playwright SEO workspace fixture passed: chart placement beneath KPIs, automatic refresh after a polled scan transitions to completed, site selection, and 390px layout. These were mocked API/browser fixtures, separate from the real PostgreSQL service tests.
- Read-only service verification against an existing local site returned 150 points: 30 UTC days and five severities. This used the runtime DAL after a privileged read-only site lookup; it was not an authenticated browser session.
- Rebuilt/recreated Docker server and client successfully. Server health returned 200, the SEO workspace returned 200, and an unauthenticated trend request returned 401. The runtime role is `tapcrm_app` with `rolbypassrls = false`; both `seo_sites` and `seo_findings` have ENABLE and FORCE RLS.

## Startup repair

The first restart exposed existing migration drift: `0110_seo_intelligence_content.sql` had added a backlink column after being applied. Recovered the original bytes from the previous local image and verified SHA-256 `a02eab5d6297dd2154214b2bed58e0b3b9674e5af5cb656c069e9041493135aa` against the database history. Migration `0113` already creates the column. The final restart reports no pending migrations; migration history was not rewritten.

## Existing repository-wide failures

Full lint still reports three errors outside the trend implementation: unused `Card` in `ClientProjectsPage.tsx`, an unnecessary assertion in `crawler/render.ts`, and unused `createConnection` in `crawler/ssrf-guard.ts`.

CI still reports two existing blockers: numeric `costCents` in SEO provider types violates the monetary-field rule, and the registered `seo_finding` policy has no registry action naming that resource. CI's source check passes RLS protection on all 248 tenant-owned tables.

## History limits

Past totals are estimates reconstructed from first sightings and the latest resolution. Earlier closure/reopen cycles, severity changes, and missing historical resolution timestamps cannot be recovered from the current schema. This limitation appears in the chart and setup documentation. No new migration or external-provider request is required for the chart.
