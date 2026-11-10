# SEO Intelligence Module Setup

The SEO Intelligence module provides site crawl audits, Core Web Vitals tracking, rank monitoring, AI-visibility scoring, backlink analysis, and per-tenant rule management. It lives at `/company/seo-intelligence` in the CRM UI and is gated by the `seo-intelligence` module key.

## Using the dashboard

The **Website SEO** workspace keeps the CRM's main sidebar and organizes its tools into five horizontal tabs: **Overview**, **Website health**, **Search visibility**, **Activity**, and **Settings**. The selected website applies to each tool. On phones, tabs scroll horizontally; keyboard users can move with the arrow keys, Home, and End.

Start with Overview's priority list and checkup coverage. Website health explains findings in grouped issue cards with evidence and next steps, then provides individual findings with filters and pagination. Search visibility explains Google traffic, search terms, saved positions, AI mentions, and incoming links. Activity holds checkup history and reviewed notifications. Settings manages websites and the checks included in future checkups.

The coverage ring is not an SEO score. Marking a recommendation done only updates its CRM record; make the actual website change first, then run another checkup to verify it. Missing measurements and unavailable providers are identified explicitly.

## Enable and configure

1. Apply migrations in order. Run `npm run migrate` to execute all pending migrations. Key migrations for this module:
   - `0108` – `seo_sites`, `seo_scan_runs`, `seo_findings` — core crawl tables.
   - `0109` – `seo_gsc_metrics` — Google Search Console import.
   - `0110` – `seo_keywords`, `seo_serp_observations`, `seo_ai_observations` — rank and AI-visibility tracking.
   - `0111` – `seo_backlinks`, `seo_alerts` — backlink graph and monitoring alerts.
   - `0112` – `seo_fix_proposals` — AI-generated fix proposals per finding.
   - `0113` – `seo_cwv_observations`, `registry_seo_rule`; adds `difficulty` column to `seo_keywords` and `domain_rating` to `seo_backlinks`.

   All tables carry `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` policies scoped to `current_organization_id()`.

2. Enable the module when creating an organization via the platform admin UI, or by inserting a row in `organization_module`. On first enable, `provisionSeoRules` is called inside the creation transaction and seeds the `registry_seo_rule` table from the global crawler rule catalogue. The seed is idempotent (`ON CONFLICT DO NOTHING`).

3. Per-tenant rule overrides: operators can toggle individual rules on/off via the SEO Dashboard → Rules tab. `active = false` disables a rule globally for that org's scans; `tested = false` suppresses a rule from production runs until QA sign-off.

## External service dependencies

| Service | Used for | Required |
|---|---|---|
| Google Search Console — the organization's own Google logins (Social → Company connections) | `seo_gsc_metrics` import, project rank fetching | Optional |
| CrUX API (`CRUX_API_KEY`, or an eligible `PAGESPEED_API_KEY`) | Origin-level real-user Core Web Vitals | Optional |
| PageSpeed Insights (`PAGESPEED_API_KEY`) | Lighthouse mobile lab performance | Optional |
| SerpApi (`SERPAPI_API_KEY`) | Live country/device organic rank observations | Optional |
| Moz / Ahrefs | `domain_rating` on backlinks | Optional |

Core crawl audits do not require these integrations. Search Performance reports missing credentials, property-access errors, and transient Google failures explicitly; empty imported data is not treated as evidence of a disconnected account.

Docker forwards `GOOGLE_SEARCH_CONSOLE_AUTH`, the OAuth/service-account variables, and `SERPAPI_API_KEY` into the server. After changing `.env`, recreate the server with `docker compose up -d server`. Source changes require `docker compose up -d --build`.

Search Console is read per organization. Each organization connects its own Google login under **Social → Company connections**; the properties that login can read are listed there and can be assigned to clients. Imports and project rank fetching read only through the organization's own logins (`modules/social/facade.ts` → `searchConsoleToken`), so no organization can list, link or read another's property. The server's shared login (`GOOGLE_SEARCH_CONSOLE_AUTH` + its credentials) serves only the organization named in `GOOGLE_SEARCH_CONSOLE_ORGANIZATION`.

GSC imports match the registered website against the organization's properties (those assigned to the website's client first), preserve the exact property identifier, request daily dimensions, and upsert at the actual daily grain. The displayed 28-day window ends three days ago. Query rows can be incomplete due to Google's reporting limits; displayed totals cover the loaded rows.

Live SERP checks require migration `0116_seo_serp_allowance.sql` and an explicitly configured `seo_serp_allowance` row for the organization/site. The default allowance is zero. Provision the approved monthly search limit through a tenant-scoped DAL operation. The UI displays used/remaining searches and offers **Check ranks now**. No API key is returned to the browser.

Scheduled and manual checks share the same reservation logic: the allowance row is locked before each outbound search, attempts count toward the UTC calendar-month limit, and each keyword can reserve at most one search per UTC day. Weekly/monthly keyword cadence is also respected. Each batch handles at most ten due keyword/country/device combinations. Candidate keywords are harvested from imported GSC queries. Unsupported country codes and tablet observations are skipped rather than silently targeted to another country/device. Missing targets are shown as **Not seen in returned results**, not a claim that the website never ranks.

## Findings trend

The Overview displays a 30-day Chart.js stacked area chart of estimated open findings by severity. It refreshes when the selected site's scan status or loaded findings change. Severity buttons support keyboard toggling, and **View daily trend data** exposes every count in a table. Failed refreshes retain the last loaded chart with an explicit notice and retry action.

`GET /api/seo/sites/:siteId/findings-trend?days=30` requires `seo:read-findings-trend`, an enabled SEO module, and access to the site's organization. `days` accepts whole numbers from 1 through 180 and defaults to 30; invalid values return a validation error. Responses contain `{ day, severity, openCount }` for all five severities on every requested UTC day, including zeros. `day` is a `YYYY-MM-DD` calendar date. Past buckets represent the end of the day; today's bucket represents the time of the request.

History is reconstructed from first sightings and the latest resolution timestamps. Verified resolutions, accepted exceptions, and false positives close a finding; reopening clears its resolution timestamp. Older reopen cycles and severity changes are not stored as events, and older closed findings without a resolution timestamp cannot be dated accurately. The chart labels these historical totals as estimates. This feature adds no migration or external-provider requirement.

## Crawler rule catalogue

Rules live under `packages/server/src/modules/seo-intelligence/crawler/rules/`. Each rule file calls `registerRule()` on import; the barrel `index.ts` imports all rule groups so the catalogue is fully assembled at server start. `getActiveRules()` returns only rules where `active === true && tested === true`.

To add a new rule:

1. Create a file under `crawler/rules/<group>/your-rule.ts` and call `registerRule(...)`.
2. Import the file from `crawler/rules/<group>/index.ts`.
3. Run the suite: `npm test --workspace=packages/server`.
4. Set `tested: false` until QA approves; flip to `true` to enable in production runs.

## Authorization actions

The module registers 22 actions under the `seo` namespace (e.g., `seo:view-dashboard`, `seo:trigger-scan`, `seo:update-rule`). See `security/AUTHORIZATION.md` §6.4 for the full list and their role bindings.


## Performance data and troubleshooting

Apply migration `0117_seo_performance_status.sql`. The Core Web Vitals screen distinguishes CrUX real-user origin data from PageSpeed/Lighthouse lab tests. A lab score is not a field CWV result and lab TBT is not INP. Missing metrics remain null.

CrUX requires an API key with Chrome UX Report API enabled and allowed by the key restrictions. The server uses `CRUX_API_KEY` when set, otherwise it tries `PAGESPEED_API_KEY`. GSC OAuth does not establish CrUX access. HTTP 404 is recorded as no eligible field samples; denied API access and quota failures are recorded separately. No measurement is invented for those states.

The existing scan stages enqueue performance jobs after the HTML crawl. **Refresh performance** also queues a CrUX check and one homepage Lighthouse test without recrawling the website. The screen polls saved provider status and observations. A scan's automatic Lighthouse stage can additionally test top pages from GSC.

After changing keys, recreate the server so the new environment reaches Docker. Configure both service enablement and API-key restrictions in Google Cloud; an `API_KEY_SERVICE_BLOCKED` response indicates that the key is not allowed to call that service.
