import { randomUUID } from 'node:crypto';
import { defineJob, type OrganizationJobRun } from '../../platform/jobs/runner.js';
import type { RunOutcome } from '../../platform/jobs/run-record.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import type { SeoJobPayload } from './types.js';
import { importGscPerformance, gscSyncWindow, pruneGscMetrics } from './gsc-sync.js';
import { searchConsoleConnected } from '../social/facade.js';
import { refreshCrux, refreshLighthouse } from './performance.js';
import { checkSiteRanks } from './rank-tracking.js';
import { harvestKeywordsFromGsc } from './gsc-keywords.js';
import { mozFetchBacklinks } from './providers/moz.js';
import { createPerplexityProvider } from './providers/perplexity.js';
import { createSerpApiAiOverviewProvider } from './providers/serpapi-ai-overview.js';
import { discoverScan, fetchBatch, evaluateScan, startUrl } from './crawl.js';
import { ensureScanConfig } from './scan-config.js';
import {
  lastProviderCall, providerConfigured, reserveAiOverviewSearch, reserveProviderCall,
} from './provider-allowance.js';
import { normalizeUrl } from './url.js';

export { normalizeUrl } from './url.js';
export { isExcluded } from './crawl.js';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const DAY = 24 * 60 * 60_000;
/** Backlink data moves slowly; one paid lookup a week per site is plenty. */
const BACKLINK_INTERVAL_MS = 7 * DAY;

// Exported handles so service.ts can enqueue without re-calling defineJob
export let crawlDiscoverHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let crawlFetchHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let evaluateHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let cruxFetchHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let lighthouseAuditHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let serpObserveHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let gscSyncHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let backlinksFetchHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let aiVisibilityObserveHandle: ReturnType<typeof defineJob<SeoJobPayload>>;
export let schedulerHandle: ReturnType<typeof defineJob<SeoJobPayload>>;

function warn(msg: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: 'warn', msg, ...fields }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

/**
 * A checkup stage. A failure is retried; the checkup is only marked failed
 * once the last attempt has failed, so a transient error does not show a
 * failed checkup that later completes.
 */
function scanStage(attempts: number, handler: (run: OrganizationJobRun<SeoJobPayload>) => Promise<RunOutcome>) {
  return async (run: OrganizationJobRun<SeoJobPayload>) => {
    try { return await handler(run); }
    catch (error) {
      if (run.payload.scanRunId && run.attempt >= attempts) await db.query(run.ctx, sql`
        UPDATE seo_scan_runs SET status = 'failed', ended_at = now(),
          termination_reason = 'The audit worker failed. Retry the scan or contact an administrator.',
          notes = ${errorMessage(error)}
        WHERE organization_id = ${run.ctx.organizationId} AND id = ${run.payload.scanRunId}
          AND status NOT IN ('completed', 'completed_partial', 'cancelled')
      `);
      throw error;
    }
  };
}

/** Runs `work` for each active site (or one), so one site's failure never stops the others. */
async function forEachSite(
  ctx: RequestContext,
  job: string,
  targetSiteId: string | undefined,
  work: (site: { id: string; clientId: string | null; displayUrl: string; normalizedHost: string; scopePath: string | null }) => Promise<number>,
): Promise<RunOutcome> {
  const sites = await db.query<{ id: string; clientId: string | null; displayUrl: string; normalizedHost: string; scopePath: string | null }>(ctx, sql`
    SELECT id, client_id, display_url, normalized_host, scope_path FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND active = true
      AND (${targetSiteId ?? null}::uuid IS NULL OR id = ${targetSiteId ?? null}::uuid)
  `);
  let processed = 0;
  let failures = 0;
  let lastError: unknown = null;
  for (const site of sites) {
    try {
      processed += await work(site);
    } catch (error) {
      failures++;
      lastError = error;
      warn(`${job} failed for a site`, { organizationId: ctx.organizationId, siteId: site.id, error: errorMessage(error) });
    }
  }
  // Every site failing is worth a retry; some failing is reported and skipped.
  if (sites.length > 0 && failures === sites.length) throw lastError;
  return { itemsProcessed: processed };
}

export function registerSeoJobs(): void {
  crawlDiscoverHandle = defineJob<SeoJobPayload>({
    name: 'seo:crawl_discover',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 2,
    backoffMs: 60_000,
    handler: scanStage(2, async ({ ctx, payload }) => {
      const { siteId, scanRunId } = payload;
      if (!scanRunId) return { itemsProcessed: 0 };
      const queued = await discoverScan(ctx, siteId, scanRunId);
      // Field data first, so the evaluation can use a fresh reading.
      await cruxFetchHandle.enqueue({
        organizationId: ctx.organizationId,
        key: `seo:crux:${siteId}:${scanRunId}`,
        payload: { organizationId: ctx.organizationId, siteId },
      });
      await crawlFetchHandle.enqueue({
        organizationId: ctx.organizationId,
        key: `seo:fetch:${scanRunId}:1`,
        payload: { organizationId: ctx.organizationId, siteId, scanRunId, extra: { batch: 1 } },
      });
      return { itemsProcessed: queued };
    }),
  });

  crawlFetchHandle = defineJob<SeoJobPayload>({
    name: 'seo:crawl_fetch',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 3,
    backoffMs: 30_000,
    handler: scanStage(3, async ({ ctx, payload }) => {
      const { siteId, scanRunId } = payload;
      if (!scanRunId) return { itemsProcessed: 0 };
      const more = await fetchBatch(ctx, siteId, scanRunId);
      if (more) {
        const batch = Number(payload.extra?.['batch'] ?? 1) + 1;
        await crawlFetchHandle.enqueue({
          organizationId: ctx.organizationId,
          key: `seo:fetch:${scanRunId}:${batch}`,
          payload: { organizationId: ctx.organizationId, siteId, scanRunId, extra: { batch } },
        });
      } else {
        await evaluateHandle.enqueue({
          organizationId: ctx.organizationId,
          key: `seo:eval:${scanRunId}`,
          payload: { organizationId: ctx.organizationId, siteId, scanRunId },
        });
      }
      return { itemsProcessed: more ? 1 : 0 };
    }),
  });

  evaluateHandle = defineJob<SeoJobPayload>({
    name: 'seo:evaluate',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 2,
    backoffMs: 60_000,
    handler: scanStage(2, async ({ ctx, payload }) => {
      const { siteId, scanRunId } = payload;
      if (!scanRunId) return { itemsProcessed: 0 };
      const evaluated = await evaluateScan(ctx, siteId, scanRunId);
      // Lab tests for the start page and top traffic pages; slower, so separate.
      await lighthouseAuditHandle.enqueue({
        organizationId: ctx.organizationId,
        key: `seo:lighthouse:${siteId}:${scanRunId}`,
        payload: { organizationId: ctx.organizationId, siteId },
      });
      return { itemsProcessed: evaluated };
    }),
  });

  cruxFetchHandle = defineJob<SeoJobPayload>({
    name: 'seo:crux_fetch',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: DAY },
    attempts: 3,
    backoffMs: 5 * 60_000,
    handler: async ({ ctx, payload }) =>
      forEachSite(ctx, 'seo:crux_fetch', (payload as SeoJobPayload | undefined)?.siteId,
        (site) => refreshCrux(ctx, site.id, site.displayUrl)),
  });

  lighthouseAuditHandle = defineJob<SeoJobPayload>({
    name: 'seo:lighthouse_audit',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 2,
    backoffMs: 10 * 60_000,
    handler: async ({ ctx, payload }) => {
      const { siteId } = (payload ?? {});
      if (!siteId) return { itemsProcessed: 0 };
      return forEachSite(ctx, 'seo:lighthouse_audit', siteId, async (site) => {
        // Start page + top-4 pages by Google clicks (28d). Lighthouse is slow
        // and PageSpeed's quota is bounded.
        const topUrls = await db.query<{ url: string }>(ctx, sql`
          SELECT page AS url, SUM(clicks)::integer AS total_clicks FROM seo_gsc_metrics
          WHERE organization_id = ${ctx.organizationId} AND site_id = ${site.id} AND page IS NOT NULL
            AND date >= (current_date - interval '28 days')::date
          GROUP BY page ORDER BY total_clicks DESC LIMIT 4
        `);
        const candidates = payload.extra?.['homepageOnly'] === true
          ? [startUrl(site)]
          : [startUrl(site), ...topUrls.map((r) => r.url)];
        const urls = new Set(candidates.map((url) => normalizeUrl(url)).filter((url): url is string => url !== null));
        let audited = 0;
        for (const url of urls) audited += await refreshLighthouse(ctx, site.id, url);
        return audited;
      });
    },
  });

  serpObserveHandle = defineJob<SeoJobPayload>({
    name: 'seo:serp_observe',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: DAY },
    attempts: 3,
    backoffMs: 5 * 60_000,
    handler: async ({ ctx, payload }) =>
      forEachSite(ctx, 'seo:serp_observe', (payload as SeoJobPayload | undefined)?.siteId,
        (site) => checkSiteRanks(ctx, site.id)),
  });

  gscSyncHandle = defineJob<SeoJobPayload>({
    name: 'seo:gsc_sync',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: DAY },
    attempts: 3,
    backoffMs: 5 * 60_000,
    handler: async ({ ctx, payload }) => {
      // Only an organization with its own Google login (or the shared login's one
      // organization) has anything to import.
      if (!(await searchConsoleConnected(ctx))) return { itemsProcessed: 0 };
      return forEachSite(ctx, 'seo:gsc_sync', (payload as SeoJobPayload | undefined)?.siteId, async (site) => {
        // A full 90-day import once, then only the last few days, which
        // Search Console still revises.
        const window = await gscSyncWindow(ctx, site.id);
        const result = await importGscPerformance(ctx, site.id, site.displayUrl, window.startDate, window.endDate, site.clientId);
        await pruneGscMetrics(ctx, site.id);
        // Top queries become suggested search terms (only a few are tracked automatically).
        await harvestKeywordsFromGsc(ctx, site.id);
        return result.synced;
      });
    },
  });

  backlinksFetchHandle = defineJob<SeoJobPayload>({
    name: 'seo:backlinks_fetch',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: DAY },
    attempts: 2,
    backoffMs: 30 * 60_000,
    handler: async ({ ctx, payload }) => {
      if (!providerConfigured('moz')) return { itemsProcessed: 0 };
      const targetSiteId = (payload as SeoJobPayload | undefined)?.siteId;
      return forEachSite(ctx, 'seo:backlinks_fetch', targetSiteId, async (site) => {
        const last = await lastProviderCall(ctx, site.id, 'moz');
        if (!targetSiteId && last && Date.now() - last.getTime() < BACKLINK_INTERVAL_MS) return 0;
        if (!(await reserveProviderCall(ctx, site.id, 'moz', 'backlinks'))) return 0;
        const result = await mozFetchBacklinks(site.normalizedHost);
        if (result.state !== 'ok' || !result.data) return 0;
        let inserted = 0;
        for (const link of result.data.links) {
          const rows = await db.query<{ id: string }>(ctx, sql`
            INSERT INTO seo_backlinks
              (id, site_id, organization_id, source_url, source_domain, target_url, anchor_text, rel_values,
               provider, confidence, domain_rating, first_seen_at, last_seen_at)
            VALUES
              (${randomUUID()}, ${site.id}, ${ctx.organizationId}, ${link.sourceUrl}, ${link.sourceDomain},
               ${link.targetUrl}, ${link.anchorText}, ${link.relValues}::text[], 'moz', 'direct',
               ${link.domainAuthority}, ${link.firstSeen}, now())
            ON CONFLICT (site_id, source_url, target_url) DO UPDATE SET
              anchor_text = EXCLUDED.anchor_text, rel_values = EXCLUDED.rel_values,
              domain_rating = EXCLUDED.domain_rating, last_seen_at = now()
            RETURNING id
          `);
          inserted += rows.length;
        }
        return inserted;
      });
    },
  });

  aiVisibilityObserveHandle = defineJob<SeoJobPayload>({
    name: 'seo:ai_visibility_observe',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: DAY },
    attempts: 2,
    backoffMs: 30 * 60_000,
    handler: async ({ ctx, payload }) => {
      // Perplexity when its key is set (off-Google coverage); otherwise Google
      // AI Overviews through SerpApi. Neither runs without an approved allowance.
      const providerName = providerConfigured('perplexity')
        ? 'perplexity'
        : providerConfigured('serpapi') ? 'serpapi-ai-overview' : null;
      if (!providerName) return { itemsProcessed: 0 };
      const provider = providerName === 'perplexity' ? createPerplexityProvider() : createSerpApiAiOverviewProvider();

      return forEachSite(ctx, 'seo:ai_visibility_observe', (payload as SeoJobPayload | undefined)?.siteId, async (site) => {
        await ensureDefaultPromptSet(ctx, site.id, site.normalizedHost);
        const duePrompts = await db.query<{
          promptId: string; promptText: string; brandAliases: string[]; platforms: string[]; locale: string;
        }>(ctx, sql`
          SELECT p.id AS prompt_id, p.prompt_text, ps.brand_aliases, ps.platforms, ps.locale
          FROM seo_ai_prompts p
          JOIN seo_ai_prompt_sets ps ON ps.id = p.prompt_set_id
          WHERE p.organization_id = ${ctx.organizationId} AND ps.site_id = ${site.id}
            AND p.active = true AND ps.active = true AND ps.cadence IN ('daily', 'weekly', 'monthly')
            AND NOT EXISTS (
              SELECT 1 FROM seo_ai_observations o
              WHERE o.prompt_id = p.id
                AND o.observed_at > now() - (CASE ps.cadence
                  WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days'
                  WHEN 'monthly' THEN interval '30 days' END)
            )
        `);
        let observed = 0;
        for (const prompt of duePrompts) {
          const platforms = prompt.platforms.length > 0 ? prompt.platforms : ['perplexity'];
          for (const platform of platforms) {
            const reserved = providerName === 'perplexity'
              ? await reserveProviderCall(ctx, site.id, 'perplexity', 'ai_visibility')
              : await reserveAiOverviewSearch(ctx, site.id);
            if (!reserved) return observed; // allowance unset or used up for this month
            const result = await provider.observe({
              prompt: prompt.promptText,
              platform,
              locale: prompt.locale,
              language: prompt.locale.split('-')[0] ?? 'en',
              brandAliases: prompt.brandAliases,
              domain: site.normalizedHost,
            });
            const state = result.state === 'ok' ? 'success' : 'failed';
            await db.query(ctx, sql`
              INSERT INTO seo_ai_observations
                (id, prompt_id, site_id, organization_id, provider, platform, locale,
                 brand_mentioned, domain_cited, citation_urls, competitor_mentions, state)
              VALUES
                (${randomUUID()}, ${prompt.promptId}, ${site.id}, ${ctx.organizationId},
                 ${providerName}, ${platform}, ${prompt.locale},
                 ${result.data?.brandMentioned ?? null}, ${result.data?.domainCited ?? null},
                 ${result.data?.citationUrls ?? []}::text[],
                 ${JSON.stringify(result.data?.competitorMentions ?? [])}::jsonb, ${state})
            `);
            observed++;
          }
        }
        return observed;
      });
    },
  });

  schedulerHandle = defineJob<SeoJobPayload>({
    name: 'seo:scheduler',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: DAY },
    attempts: 2,
    backoffMs: 60 * 60_000,
    handler: async ({ ctx }) => {
      // Weekly checkups: sites with no checkup in flight and none finished in 7 days.
      const dueSites = await db.query<{ id: string }>(ctx, sql`
        SELECT s.id FROM seo_sites s
        WHERE s.organization_id = ${ctx.organizationId} AND s.active = true
          AND NOT EXISTS (
            SELECT 1 FROM seo_scan_runs r WHERE r.site_id = s.id
              AND r.status IN ('queued', 'discovering', 'fetching', 'rendering', 'evaluating', 'aggregating'))
          AND NOT EXISTS (
            SELECT 1 FROM seo_scan_runs r WHERE r.site_id = s.id
              AND r.status IN ('completed', 'completed_partial') AND r.ended_at > now() - interval '7 days')
      `);

      let triggered = 0;
      for (const { id: siteId } of dueSites) {
        const scanRunId = randomUUID();
        await db.transaction(ctx, async (tx) => {
          await tx.one(sql`SELECT id FROM seo_sites WHERE organization_id = ${ctx.organizationId} AND id = ${siteId} FOR UPDATE`);
          const config = await ensureScanConfig(tx, ctx.organizationId, siteId);
          await tx.query(sql`
            INSERT INTO seo_scan_runs (id, organization_id, site_id, config_id, status, triggered_by, queued_at)
            VALUES (${scanRunId}, ${ctx.organizationId}, ${siteId}, ${config.id}, 'queued', ${SYSTEM_ID}::uuid, now())
          `);
        });
        await crawlDiscoverHandle.enqueue({
          organizationId: ctx.organizationId,
          key: `seo:discover:${scanRunId}`,
          payload: { organizationId: ctx.organizationId, siteId, scanRunId },
        });
        triggered++;
      }
      return { itemsProcessed: triggered };
    },
  });
}

/**
 * Idempotent: ensures a site has at least one AI prompt set + prompts. First
 * run seeds a basic brand/service question so AI Visibility is populated out
 * of the box; later edits (new prompts, new platforms) are the user's.
 */
async function ensureDefaultPromptSet(ctx: RequestContext, siteId: string, normalizedHost: string): Promise<void> {
  const existing = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT id FROM seo_ai_prompt_sets
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND name = 'Default'
    LIMIT 1
  `);
  if (existing) return;

  const brandAlias = normalizedHost.split('.')[0] ?? normalizedHost;
  const setId = randomUUID();
  const platforms = [
    ...(process.env['PERPLEXITY_API_KEY'] ? ['perplexity'] : []),
    ...(process.env['SERPAPI_API_KEY'] ? ['google_ai_overview'] : []),
  ];
  await db.query(ctx, sql`
    INSERT INTO seo_ai_prompt_sets
      (id, site_id, organization_id, name, brand_aliases, platforms, cadence, active)
    VALUES
      (${setId}, ${siteId}, ${ctx.organizationId}, 'Default',
       ${[brandAlias, normalizedHost]}::text[],
       ${platforms.length > 0 ? platforms : ['perplexity']}::text[],
       'weekly', true)
  `);

  const defaultPrompts = [
    `What are the best companies that offer services like ${brandAlias}?`,
    `Tell me about ${brandAlias} — who they are and what they do.`,
    `What alternatives exist to ${brandAlias}?`,
  ];
  for (const prompt of defaultPrompts) {
    await db.query(ctx, sql`
      INSERT INTO seo_ai_prompts (id, prompt_set_id, organization_id, prompt_text, active)
      VALUES (${randomUUID()}, ${setId}, ${ctx.organizationId}, ${prompt}, true)
    `);
  }
}

export { normalizeKeywordDevice } from './gsc-keywords.js';
