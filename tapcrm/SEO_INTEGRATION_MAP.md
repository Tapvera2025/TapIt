# SEO Intelligence — Repository Integration Map

**Produced:** 2026-10-24  
**Purpose:** Satisfy PRD §8.1 — inspect repo before modifications, document reuse vs. new.

---

## 1. What already exists (do NOT duplicate)

| Path | Responsibility | Decision |
|---|---|---|
| `packages/server/src/modules/projects/reports/` | Per-project keyword tracking, rank history, blog posts, backlinks, screenshots, PDF reports | **Retain** — these are project-level SEO records; the new module is client/site-level |
| `packages/server/src/platform/integrations/google/search-console.ts` | GSC search analytics queries, property listing | **Reuse** — call directly from new module |
| `packages/server/src/platform/integrations/google/token.ts` | Google service-account OAuth token cache | **Reuse** — same token flow, add new scopes for URL Inspection |
| `packages/server/src/modules/projects/reports/rank-provider.ts` | `RankProvider` interface + GSC adapter | **Reuse** the interface; extend with SERP adapter |
| `packages/server/src/modules/projects/reports/search-console-provider.ts` | GSC rank provider adapter | **Reuse** for keyword rank sync in new module |
| `packages/contracts/src/module.ts` | Module catalog and phase mapping | **Extend** — add `seo-intelligence` to CLIENT_MODULES group |
| `packages/server/src/modules/index.ts` | Module registration | **Extend** — register new module |
| `packages/client/src/company/CompanyWorkspace.tsx` | SPA route dispatch | **Extend** — add `/company/seo-intelligence` routes |
| `packages/client/src/company/layout/CompanySidebar.tsx` | Navigation sidebar | **Extend** — add SEO Intelligence nav item |
| `team-docs/security/AUTHORIZATION.md` §6.4, §6.5 | Action and binding source of truth | **Extend** — add 8 new actions + all API bindings |
| `packages/contracts/src/registry.generated.ts` | Generated — do NOT hand-edit | **Regenerate** with `npm run registry:extract` after AUTHORIZATION.md update |
| DB tables `project_seo_keyword`, `project_seo_rank_history`, `project_seo_blog`, `project_seo_search_console_link` | Project-scoped SEO records | **Retain unchanged** — new module adds separate `seo_*` tables |
| `packages/server/src/platform/` (DAL, auth, jobs, outbox) | Platform infrastructure | **Reuse** entirely |

---

## 2. What is new (new files and migrations)

### 2.1 Database migrations (0104–0112)

| File | Tables created |
|---|---|
| `0104_seo_intelligence_sites.sql` | `seo_sites`, `seo_site_seeds`, `seo_scan_configs` |
| `0105_seo_intelligence_scans.sql` | `seo_scan_runs`, `seo_scan_url_states`, `seo_page_observations`, `seo_link_edges` |
| `0106_seo_intelligence_findings.sql` | `seo_rules`, `seo_rule_evaluations`, `seo_findings`, `seo_finding_instances`, `seo_root_cause_groups`, `seo_issue_exceptions`, `seo_tasks_bridge` |
| `0107_seo_intelligence_providers.sql` | `seo_provider_connections`, `seo_provider_usage`, `seo_provider_requests`, `seo_evidence_blobs` |
| `0108_seo_intelligence_search.sql` | `seo_gsc_metrics`, `seo_index_inspections`, `seo_cwv_observations` |
| `0109_seo_intelligence_keywords.sql` | `seo_keyword_sets`, `seo_keywords`, `seo_keyword_page_maps`, `seo_serp_observations` |
| `0110_seo_intelligence_content.sql` | `seo_competitors`, `seo_competitor_page_snapshots`, `seo_backlinks`, `seo_business_locations` |
| `0111_seo_intelligence_ai.sql` | `seo_ai_prompt_sets`, `seo_ai_observations`, `seo_ai_analysis_runs` |
| `0112_seo_intelligence_ops.sql` | `seo_fix_proposals`, `seo_change_events`, `seo_alerts`, `seo_reports`, `seo_audit_log` |

### 2.2 Server module

`packages/server/src/modules/seo-intelligence/`

```
index.ts                  — registration exports
policy.ts                 — RBAC resource policies
routes.ts                 — all API route handlers
service.ts                — business logic
repository.ts             — DB queries
validators.ts             — Zod input schemas
types.ts                  — internal TypeScript types
errors.ts                 — typed error classes
cost-governor.ts          — provider budget enforcement
providers/
  types.ts                — ProviderResult<T>, SourceState interfaces
  gsc.ts                  — GSC search performance adapter
  crux.ts                 — CrUX field data adapter
  lighthouse.ts           — Lighthouse lab audit adapter
  serpapi.ts              — SerpApi SERP observation adapter
  brightdata.ts           — Bright Data AI/SERP adapter (stub, awaits account)
  apify.ts                — Apify fallback adapter (stub)
crawler/
  frontier.ts             — URL discovery, scope, dedup
  fetch.ts                — HTTP fetch worker (SSRF-safe)
  ssrf-guard.ts           — DNS/IP/redirect guard
  rules/
    index.ts              — rule registry
    http.ts               — H001–H012
    robots.ts             — I001–I012
    canonicalization.ts   — C001–C010
    meta.ts               — M001–M012
    content.ts            — T001–T012
    links.ts              — L001–L012
    images.ts             — A001–A010
    sitemaps.ts           — S001–S010
    schema.ts             — D001–D010
    international.ts      — G001–G010
    performance.ts        — P001–P010
jobs.ts                   — job definitions for scan/sync/alert
```

### 2.3 Client module

`packages/client/src/seo-intelligence/`

```
SeoWorkspace.tsx          — top-level router for /company/seo-intelligence/*
api.ts                    — API client
types.ts                  — shared types matching contracts
pages/
  OverviewPage.tsx
  SitesPage.tsx
  AuditPage.tsx
  IssueExplorerPage.tsx
  IssueDetailPage.tsx
  SearchPerformancePage.tsx
  KeywordsPage.tsx
  RankTrackerPage.tsx
  CompetitorPage.tsx
  ContentPage.tsx
  LinksPage.tsx
  BacklinksPage.tsx
  PerformancePage.tsx
  LocalSeoPage.tsx
  AiVisibilityPage.tsx
  FixStudioPage.tsx
  TasksPage.tsx
  AlertsPage.tsx
  ReportsPage.tsx
  IntegrationsPage.tsx
  RulesPage.tsx
  IndexIntelligencePage.tsx
```

---

## 3. Key architectural decisions

- **SEO sites are linked to existing CRM clients** (`client_id` FK). No parallel client table.
- **Tasks bridge to the existing task system** via `seo_tasks_bridge`. No new task engine.
- **PDF reports reuse** `packages/server/src/modules/projects/reports/pdf.ts` patterns but produce `seo_reports` snapshots.
- **SSRF guard** is a new strict guard in `crawler/ssrf-guard.ts`; it wraps every DNS resolution and every browser subrequest.
- **Cost governor** defaults `paid_external_usd_budget = 0`; no paid provider fires without admin opt-in.
- **Google token** reuses the existing service-account flow; URL Inspection requires the same scope as GSC, so no new OAuth consent is needed for the existing read-only scope. GA4 requires a separate OAuth scope and property selection.
- **The existing `project_seo_*` tables are untouched**. The new `seo_*` tables are a separate concern (site-level vs. project-level).

---

## 4. Uncertain assumptions (require verification on integration day)

- Google URL Inspection API quota (2,000/day/property) — guard before queuing inspections.
- Bright Data free credit availability — account test required; adapter ships in `stub` mode until verified.
- GA4 Data API requires a separate OAuth scope (`analytics.readonly`) not currently in the service-account config.
- Playwright availability in the server Docker container — currently not installed; Dockerfile update required.
- `dump.rdb` at the repo root indicates Redis is used for caching/queues; confirm the job queue client library before wiring crawler jobs.
