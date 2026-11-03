import { randomUUID, createHash } from 'node:crypto';
import { defineJob, type OrganizationJobRun } from '../../platform/jobs/runner.js';
import type { RunOutcome } from '../../platform/jobs/run-record.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import type { SeoJobPayload } from './types.js';
import { importGscPerformance } from './gsc-sync.js';
import { googleAuthConfigured } from '../../platform/integrations/google/token.js';
import { refreshCrux, refreshLighthouse } from './performance.js';
import { checkSiteRanks } from './rank-tracking.js';
import { harvestKeywordsFromGsc } from './gsc-keywords.js';
import { mozFetchBacklinks } from './providers/moz.js';
import { createPerplexityProvider } from './providers/perplexity.js';
import { createSerpApiAiOverviewProvider } from './providers/serpapi-ai-overview.js';
import { safeFetch, FetchError } from './crawler/http.js';
import { SsrfBlockedError } from './crawler/ssrf-guard.js';
import { parseHtml } from './crawler/parse.js';
import { renderPage, shouldRender } from './crawler/render.js';
import { loadRobotsPolicy, type RobotsPolicy } from './crawler/robots-policy.js';
import { fetchSitemap, discoverSitemapUrl } from './crawler/sitemap.js';
import { evaluateAll } from './crawler/rules/index.js';
import { computePriorityScore } from './priority.js';
import { hydrateObservation, type HydrationMaps } from './hydrate.js';

const FETCH_BATCH_SIZE = 10;
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

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

function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function signatureFor(ruleId: string, affectedTarget: string | null): string {
  const target = affectedTarget ?? 'site';
  return createHash('sha256').update(`${ruleId}::${target}`).digest('hex');
}

/** Drops fragment, normalizes host casing, strips default ports, and preserves query. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = '';
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
      u.port = '';
    }
    return u.toString();
  } catch {
    return null;
  }
}

/** Returns true if `url` matches any glob-like exclusion pattern (supports * and simple substrings). */
export function isExcluded(url: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (pattern.includes('*')) {
      const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (re.test(url)) return true;
    } else if (url.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function scanStage(handler: (run: OrganizationJobRun<SeoJobPayload>) => Promise<RunOutcome>) {
  return async (run: OrganizationJobRun<SeoJobPayload>) => {
    try { return await handler(run); }
    catch (error) {
      if (run.payload.scanRunId) await db.query(run.ctx, sql`
        UPDATE seo_scan_runs SET status = 'failed', ended_at = now(),
          termination_reason = 'The audit worker failed. Retry the scan or contact an administrator.',
          notes = ${error instanceof Error ? error.message.slice(0, 1000) : 'Worker failure'}
        WHERE organization_id = ${run.ctx.organizationId} AND id = ${run.payload.scanRunId}
      `);
      throw error;
    }
  };
}

export function registerSeoJobs(): void {
  crawlDiscoverHandle = defineJob<SeoJobPayload>({
    name: 'seo:crawl_discover',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 1,
    backoffMs: 60_000,
    handler: scanStage(async ({ ctx, payload }) => {
      const { siteId, scanRunId } = payload;

      await db.query(ctx, sql`
        UPDATE seo_scan_runs SET status = 'fetching', started_at = now()
        WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
      `);

      const crawlConfig = await db.one<{ maxPages: number; exclusionPatterns: string[] }>(ctx, sql`
        SELECT c.max_pages, c.exclusion_patterns FROM seo_scan_configs c
        JOIN seo_scan_runs r ON r.config_id = c.id AND r.organization_id = c.organization_id
        WHERE r.organization_id = ${ctx.organizationId} AND r.id = ${scanRunId}
      `);
      const seeds = await db.query<{ url: string }>(ctx, sql`
        SELECT input_url AS url FROM seo_site_seeds
        WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
        LIMIT 50
      `);

      // Fallback: if no seeds registered, enqueue the site's display URL itself
      let seedUrls = seeds.map((s) => s.url);
      const siteRow = await db.maybeOne<{ displayUrl: string }>(ctx, sql`
        SELECT display_url FROM seo_sites
        WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
      `);
      if (seedUrls.length === 0 && siteRow) {
        seedUrls = [siteRow.displayUrl];
      }

      seedUrls = [...new Set(seedUrls)].slice(0, crawlConfig.maxPages);
      for (const url of seedUrls) {
        await db.query(ctx, sql`
          INSERT INTO seo_scan_url_states
            (id, organization_id, scan_run_id, url, url_hash, discovery_source, state)
          VALUES
            (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${url}, ${hashUrl(url)}, 'seed', 'queued')
          ON CONFLICT (scan_run_id, url_hash) DO NOTHING
        `);
      }

      // Discover and fetch the site's sitemap; persist entries so S-rules can
      // evaluate (inSitemap, lastmod) and seed any sitemap URLs into the crawl queue.
      let sitemapUrlsSeeded = 0;
      if (siteRow) {
        const sitemapUrl = await discoverSitemapUrl(siteRow.displayUrl);
        if (sitemapUrl) {
          const { entries } = await fetchSitemap(sitemapUrl);
          for (const entry of entries.slice(0, crawlConfig.maxPages)) {
            try { if (new URL(entry.url).hostname.replace(/^www\./, '') !== new URL(siteRow.displayUrl).hostname.replace(/^www\./, '')) continue; } catch { continue; }
            if (isExcluded(entry.url, crawlConfig.exclusionPatterns) || seedUrls.includes(entry.url)) continue;
            if (seedUrls.length + sitemapUrlsSeeded >= crawlConfig.maxPages) break;
            const urlHash = hashUrl(entry.url);
            await db.query(ctx, sql`
              INSERT INTO seo_sitemap_entries
                (id, scan_run_id, organization_id, site_id, url, url_hash,
                 lastmod, changefreq, priority, sitemap_source)
              VALUES
                (${randomUUID()}, ${scanRunId}, ${ctx.organizationId}, ${siteId},
                 ${entry.url}, ${urlHash},
                 ${entry.lastmod}, ${entry.changefreq}, ${entry.priority},
                 ${sitemapUrl})
              ON CONFLICT (scan_run_id, url_hash) DO NOTHING
            `);
            await db.query(ctx, sql`
              INSERT INTO seo_scan_url_states
                (id, organization_id, scan_run_id, url, url_hash, discovery_source, state)
              VALUES
                (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${entry.url},
                 ${urlHash}, 'sitemap', 'queued')
              ON CONFLICT (scan_run_id, url_hash) DO NOTHING
            `);
            sitemapUrlsSeeded++;
          }
        }
      }

      await db.query(ctx, sql`
        UPDATE seo_scan_runs SET discovered_count = ${seedUrls.length + sitemapUrlsSeeded}
        WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
      `);

      if (crawlFetchHandle && scanRunId) {
        await crawlFetchHandle.enqueue({
          organizationId: ctx.organizationId,
          key: `seo:fetch:${scanRunId}`,
          payload: { organizationId: ctx.organizationId, siteId, scanRunId },
        });
      }

      return { itemsProcessed: seedUrls.length };
    }),
  });

  crawlFetchHandle = defineJob<SeoJobPayload>({
    name: 'seo:crawl_fetch',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 1,
    backoffMs: 30_000,
    handler: scanStage(async ({ ctx, payload }) => {
      const { siteId, scanRunId } = payload;

      const site = await db.maybeOne<{ displayUrl: string }>(ctx, sql`
        SELECT display_url FROM seo_sites
        WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
      `);
      const siteOrigin = site?.displayUrl ?? '';

      const config = await db.maybeOne<{
        maxPages: number;
        exclusionPatterns: string[];
        respectRobots: boolean;
        crawlDelayMs: number;
        renderPolicy: 'never' | 'heuristic' | 'always';
        maxRenderPages: number;
      }>(ctx, sql`
        SELECT sc.max_pages, sc.exclusion_patterns, sc.respect_robots, sc.crawl_delay_ms,
               sc.render_policy, sc.max_render_pages
        FROM seo_scan_configs sc
        JOIN seo_scan_runs sr ON sr.organization_id = sc.organization_id AND sr.config_id = sc.id
        WHERE sr.organization_id = ${ctx.organizationId} AND sr.id = ${scanRunId}
      `);
      const maxPages = config?.maxPages ?? 1000;
      const exclusionPatterns = config?.exclusionPatterns ?? [];
      const renderPolicy = config?.renderPolicy ?? 'heuristic';
      const maxRenderPages = config?.maxRenderPages ?? 100;

      // Count how many pages have already been rendered in this scan so we
      // enforce the per-scan render budget across batches.
      const renderedSoFarRow = await db.one<{ n: string }>(ctx, sql`
        SELECT COUNT(*)::text AS n FROM seo_page_observations
        WHERE organization_id = ${ctx.organizationId}
          AND scan_run_id = ${scanRunId}
          AND render_mode = 'both'
      `);
      let renderedSoFar = parseInt(renderedSoFarRow.n, 10);

      const urls = await db.query<{ id: string; url: string }>(ctx, sql`
        SELECT id, url FROM seo_scan_url_states
        WHERE organization_id = ${ctx.organizationId}
          AND scan_run_id = ${scanRunId}
          AND state = 'queued'
        ORDER BY updated_at ASC
        LIMIT ${FETCH_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `);

      if (urls.length === 0) {
        // Queue drained — hand off to evaluation
        if (evaluateHandle && scanRunId) {
          await evaluateHandle.enqueue({
            organizationId: ctx.organizationId,
            key: `seo:eval:${scanRunId}`,
            payload: { organizationId: ctx.organizationId, siteId, scanRunId },
          });
        }
        return { itemsProcessed: 0 };
      }

      let fetched = 0;
      let failed = 0;
      let safetyRejected = 0;

      const robots = new Map<string, RobotsPolicy>();
      for (const row of urls) {
        try {
          const origin = new URL(row.url).origin;
          if (config?.respectRobots !== false) {
            if (!robots.has(origin)) robots.set(origin, await loadRobotsPolicy(origin));
            const policy = robots.get(origin)!;
            if (!policy.allows(row.url)) {
              await db.query(ctx, sql`UPDATE seo_scan_url_states SET state = 'disallowed', rejection_reason = ${policy.reason}, updated_at = now()
                WHERE organization_id = ${ctx.organizationId} AND id = ${row.id}`);
              safetyRejected++;
              continue;
            }
          }
          const delay = Math.max(config?.crawlDelayMs ?? 500, robots.get(origin)?.delayMs ?? 0);
          if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
          const result = await safeFetch(row.url);
          const observation = parseHtml({ siteOrigin, fetch: result });

          const urlHash = hashUrl(result.finalUrl);
          const redirectChainJson = JSON.stringify(observation.redirectChain);
          const structuredJson = JSON.stringify(observation.schemaTypes ?? []);
          const hreflangJson = JSON.stringify(observation.hreflangTags);

          const imagesJson = JSON.stringify(observation.images);
          const schemaErrors = observation.schemaErrors ?? [];
          await db.query(ctx, sql`
            INSERT INTO seo_page_observations
              (id, organization_id, scan_run_id, url, url_hash, http_status,
               final_url, redirect_chain, content_type, content_length, response_time_ms,
               canonical_header, x_robots_tag, cache_control,
               title, meta_description, meta_robots, canonical_link, h1_texts, lang,
               content_hash, word_count, images, schema_errors,
               structured_data, hreflang_entries, render_mode, raw_size_bytes)
            VALUES
              (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${row.url}, ${urlHash},
               ${observation.httpStatus},
               ${observation.finalUrl}, ${redirectChainJson}::jsonb, ${observation.contentType},
               ${observation.contentLength}, ${observation.responseTimeMs},
               ${observation.canonicalHeader}, ${observation.xRobotsTag},
               ${result.headers['cache-control'] ?? null},
               ${observation.title}, ${observation.metaDescription}, ${observation.metaRobots},
               ${observation.canonicalLink}, ${observation.h1Text ? [observation.h1Text] : []}::text[],
               ${observation.lang},
               ${observation.contentHash}, ${observation.wordCount}, ${imagesJson}::jsonb,
               ${schemaErrors}::text[],
               ${structuredJson}::jsonb, ${hreflangJson}::jsonb,
               'raw', ${observation.contentLength})
            ON CONFLICT (scan_run_id, url_hash) DO UPDATE SET
              http_status = EXCLUDED.http_status,
              final_url = EXCLUDED.final_url,
              redirect_chain = EXCLUDED.redirect_chain,
              content_type = EXCLUDED.content_type,
              content_length = EXCLUDED.content_length,
              response_time_ms = EXCLUDED.response_time_ms,
              title = EXCLUDED.title,
              meta_description = EXCLUDED.meta_description,
              content_hash = EXCLUDED.content_hash,
              word_count = EXCLUDED.word_count,
              images = EXCLUDED.images,
              schema_errors = EXCLUDED.schema_errors,
              observed_at = now()
          `);

          await db.query(ctx, sql`
            UPDATE seo_scan_url_states
            SET state = 'fetched', http_status = ${observation.httpStatus}, updated_at = now()
            WHERE organization_id = ${ctx.organizationId} AND id = ${row.id}
          `);
          fetched++;

          // Headless render pass. "always" renders every page; "heuristic" only
          // renders when raw HTML looks JS-shelled (empty h1, no title, tiny
          // text). "never" skips entirely. Budget-capped by max_render_pages.
          const needsRender = renderPolicy === 'always'
            || (renderPolicy === 'heuristic' && shouldRender({
              wordCount: observation.wordCount,
              h1Count: observation.h1Count,
              title: observation.title,
            }));
          if (needsRender && renderedSoFar < maxRenderPages) {
            const rendered = await renderPage(result.finalUrl);
            if (rendered.state === 'ok' && rendered.contentHash) {
              await db.query(ctx, sql`
                UPDATE seo_page_observations
                SET render_mode = 'both',
                    rendered_size_bytes = ${rendered.byteLength},
                    dom_hash = ${rendered.contentHash}
                WHERE scan_run_id = ${scanRunId} AND url_hash = ${urlHash}
              `);
              renderedSoFar++;
            }
          }

          // Persist the link graph for this page so evaluate-time rules (L-group:
          // orphan pages, broken internal links, generic anchor text) can run.
          const sourceHash = hashUrl(result.finalUrl);
          for (const link of observation.outboundLinks) {
            await db.query(ctx, sql`
              INSERT INTO seo_link_edges
                (id, organization_id, scan_run_id, source_url_hash, target_url,
                 target_url_hash, anchor_text, rel_values, is_internal)
              VALUES
                (${randomUUID()}, ${ctx.organizationId}, ${scanRunId},
                 ${sourceHash}, ${link.href}, ${hashUrl(link.href)},
                 ${link.anchor}, ${link.relValues}::text[], ${link.isInternal})
            `);
          }

          const queuedCount = await db.one<{ n: string }>(ctx, sql`
            SELECT COUNT(*)::text AS n FROM seo_scan_url_states
            WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
          `);
          let totalKnown = parseInt(queuedCount.n, 10);

          for (const link of observation.outboundLinks) {
            if (totalKnown >= maxPages) break;
            if (!link.isInternal) continue;
            const normalized = normalizeUrl(link.href);
            if (!normalized) continue;
            if (isExcluded(normalized, exclusionPatterns)) continue;
            const inserted = await db.query(ctx, sql`
              INSERT INTO seo_scan_url_states
                (id, organization_id, scan_run_id, url, url_hash, discovery_source, state)
              VALUES
                (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${normalized},
                 ${hashUrl(normalized)}, 'link', 'queued')
              ON CONFLICT (scan_run_id, url_hash) DO NOTHING RETURNING id
            `);
            totalKnown += inserted.length;
          }

          await db.query(ctx, sql`
            UPDATE seo_scan_runs
            SET discovered_count = ${totalKnown}
            WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
          `);
        } catch (err) {
          if (!(err instanceof SsrfBlockedError) && !(err instanceof FetchError)) throw err;
          const isSsrf = err instanceof SsrfBlockedError;
          const reason = isSsrf ? err.message : (err instanceof FetchError ? err.message : 'fetch_error');
          await db.query(ctx, sql`
            UPDATE seo_scan_url_states
            SET state = ${isSsrf ? 'safety_rejected' : 'failed'},
                rejection_reason = ${reason},
                retry_count = retry_count + 1,
                updated_at = now()
            WHERE organization_id = ${ctx.organizationId} AND id = ${row.id}
          `);
          if (isSsrf) safetyRejected++; else failed++;
        }
      }

      await db.query(ctx, sql`
        UPDATE seo_scan_runs
        SET fetched_count = fetched_count + ${fetched},
            failed_count = failed_count + ${failed},
            skipped_count = skipped_count + ${safetyRejected}
        WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
      `);

      // Re-enqueue to drain the next batch
      await crawlFetchHandle.enqueue({
        organizationId: ctx.organizationId,
        key: `seo:fetch:${scanRunId}:next-${Date.now()}`,
        payload: { organizationId: ctx.organizationId, siteId, ...(scanRunId !== undefined ? { scanRunId } : {}) },
      });

      return { itemsProcessed: urls.length };
    }),
  });

  evaluateHandle = defineJob<SeoJobPayload>({
    name: 'seo:evaluate',
    perOrganization: true,
    module: 'seo-intelligence',
    attempts: 1,
    backoffMs: 60_000,
    handler: scanStage(async ({ ctx, payload }) => {
      const { siteId, scanRunId } = payload;

      await db.query(ctx, sql`
        UPDATE seo_scan_runs SET status = 'evaluating'
        WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
      `);

      // Load per-URL click totals from GSC for the last 28 days once so priority
      // scoring can weight findings by the affected page's traffic. Missing GSC
      // data (no connection) → empty map → priority falls back to severity×confidence.
      const clickRows = await db.query<{ page: string; totalClicks: string }>(ctx, sql`
        SELECT page, SUM(clicks)::text AS total_clicks
        FROM seo_gsc_metrics
        WHERE organization_id = ${ctx.organizationId}
          AND site_id = ${siteId}
          AND page IS NOT NULL
          AND date >= (current_date - interval '28 days')::date
        GROUP BY page
      `);
      const clicksByUrl = new Map<string, number>();
      for (const row of clickRows) clicksByUrl.set(row.page, parseInt(row.totalClicks, 10));

      const observations = await db.query<{
        id: string;
        url: string;
        httpStatus: number | null;
        finalUrl: string | null;
        title: string | null;
        metaDescription: string | null;
        metaRobots: string | null;
        canonicalLink: string | null;
        canonicalHeader: string | null;
        xRobotsTag: string | null;
        lang: string | null;
        h1Texts: string[];
        contentHash: string | null;
        contentType: string | null;
        contentLength: number | null;
        responseTimeMs: number | null;
        structuredData: unknown;
        hreflangEntries: unknown;
        redirectChain: unknown;
        wordCount: number | null;
        images: unknown;
        schemaErrors: string[];
        renderMode: 'raw' | 'rendered' | 'both';
        domHash: string | null;
      }>(ctx, sql`
        SELECT id, url, http_status, final_url, title, meta_description, meta_robots,
               canonical_link, canonical_header, x_robots_tag, lang, h1_texts, content_hash,
               content_type, content_length, response_time_ms,
               structured_data, hreflang_entries, redirect_chain, word_count, images, schema_errors,
               render_mode, dom_hash
        FROM seo_page_observations
        WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
      `);

      // Hydrate the link graph for this scan: group outbound edges by source URL,
      // count inbound internal edges per target URL, and look up http_status for
      // each known URL so L-group rules (broken links, orphans, generic anchors)
      // can evaluate against real data.
      const edgeRows = await db.query<{
        sourceUrlHash: string;
        targetUrl: string;
        targetUrlHash: string;
        anchorText: string | null;
        relValues: string[];
        isInternal: boolean;
      }>(ctx, sql`
        SELECT source_url_hash, target_url, target_url_hash, anchor_text, rel_values, is_internal
        FROM seo_link_edges
        WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
      `);
      const outboundBySourceHash = new Map<string, Array<{
        href: string; anchor: string | null; isInternal: boolean;
        relValues: string[]; statusCode: number | null;
      }>>();
      const inboundInternalCountByTargetHash = new Map<string, number>();
      for (const e of edgeRows) {
        const list = outboundBySourceHash.get(e.sourceUrlHash) ?? [];
        list.push({
          href: e.targetUrl,
          anchor: e.anchorText,
          isInternal: e.isInternal,
          relValues: e.relValues,
          statusCode: null,
        });
        outboundBySourceHash.set(e.sourceUrlHash, list);
        if (e.isInternal) {
          inboundInternalCountByTargetHash.set(
            e.targetUrlHash,
            (inboundInternalCountByTargetHash.get(e.targetUrlHash) ?? 0) + 1,
          );
        }
      }

      const urlStateRows = await db.query<{
        urlHash: string; httpStatus: number | null; discoverySource: string;
      }>(ctx, sql`
        SELECT url_hash, http_status, discovery_source FROM seo_scan_url_states
        WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
      `);
      const statusByUrlHash = new Map<string, number | null>();
      const seedUrlHashes = new Set<string>();
      for (const u of urlStateRows) {
        statusByUrlHash.set(u.urlHash, u.httpStatus);
        if (u.discoverySource === 'seed') seedUrlHashes.add(u.urlHash);
      }

      // Load the latest Lighthouse perf_score per URL (last 14 days) so P004 can
      // evaluate against lab performance data. Older rows are superseded by newer
      // observations via SELECT DISTINCT ON.
      const lhRows = await db.query<{ url: string; perfScore: number | null }>(ctx, sql`
        SELECT DISTINCT ON (url) url, perf_score
        FROM seo_cwv_observations
        WHERE organization_id = ${ctx.organizationId}
          AND site_id = ${siteId}
          AND url IS NOT NULL
          AND data_source = 'lighthouse_lab'
          AND observed_at >= now() - interval '14 days'
        ORDER BY url, observed_at DESC
      `);
      const lhScoreByUrl = new Map<string, number>();
      for (const r of lhRows) if (r.perfScore != null) lhScoreByUrl.set(r.url, r.perfScore);

      // Load the most recent origin-level CrUX reading for this site so performance
      // rules (P001/P002/P003) can evaluate against real field data. Null stays null
      // when no CrUX data exists — the rules degrade to pass() for those pages.
      const cruxRow = await db.maybeOne<{
        lcpP75: number | null; lcpRating: string | null;
        inpP75: number | null; inpRating: string | null;
        clsP75: string | null; clsRating: string | null;
      }>(ctx, sql`
        SELECT lcp_p75, lcp_rating, inp_p75, inp_rating, cls_p75, cls_rating
        FROM seo_cwv_observations
        WHERE organization_id = ${ctx.organizationId}
          AND site_id = ${siteId}
          AND url IS NULL
        ORDER BY observed_at DESC
        LIMIT 1
      `);
      type Rating = 'good' | 'needs_improvement' | 'poor';
      const toRating = (r: string | null): Rating | null =>
        r === 'good' || r === 'needs_improvement' || r === 'poor' ? r : null;
      const originCruxLcp = cruxRow?.lcpP75 != null && toRating(cruxRow.lcpRating)
        ? { p75: cruxRow.lcpP75, rating: toRating(cruxRow.lcpRating)! } : null;
      const originCruxInp = cruxRow?.inpP75 != null && toRating(cruxRow.inpRating)
        ? { p75: cruxRow.inpP75, rating: toRating(cruxRow.inpRating)! } : null;
      const originCruxCls = cruxRow?.clsP75 != null && toRating(cruxRow.clsRating)
        ? { p75: parseFloat(cruxRow.clsP75), rating: toRating(cruxRow.clsRating)! } : null;

      // Second pass: fill statusCode on each outbound link where we fetched the target
      for (const [, links] of outboundBySourceHash) {
        for (const link of links) {
          const targetHash = createHash('sha256').update(link.href).digest('hex');
          if (statusByUrlHash.has(targetHash)) link.statusCode = statusByUrlHash.get(targetHash) ?? null;
        }
      }

      // Load sitemap entries for this scan so S-group rules can evaluate.
      const sitemapRows = await db.query<{ url: string; lastmod: Date | null }>(ctx, sql`
        SELECT url, lastmod FROM seo_sitemap_entries
        WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
      `);
      const sitemapByUrl = new Map<string, { lastmod: Date | null }>();
      for (const row of sitemapRows) sitemapByUrl.set(row.url, { lastmod: row.lastmod });
      const now = Date.now();

      // Hreflang reciprocal check: for each page with hreflang tags, verify every
      // sibling we also crawled links back. Collect missing locales so G005 can fire.
      type HreflangTag = { hreflang: string; href: string; hrefIsAbsolute: boolean; langIsValid: boolean };
      const hreflangByUrl = new Map<string, HreflangTag[]>();
      for (const o of observations) {
        const tags = Array.isArray(o.hreflangEntries) ? (o.hreflangEntries as HreflangTag[]) : [];
        if (tags.length > 0) hreflangByUrl.set(o.url, tags);
      }
      const hreflangMissingByUrl = new Map<string, string[]>();
      for (const [sourceUrl, sourceTags] of hreflangByUrl) {
        const missing: string[] = [];
        for (const tag of sourceTags) {
          // x-default is a fallback marker, not a mutual reference, skip
          if (tag.hreflang.toLowerCase() === 'x-default') continue;
          const siblingTags = hreflangByUrl.get(tag.href);
          // Can only verify return links when we actually crawled the sibling
          if (!siblingTags) continue;
          const linksBack = siblingTags.some((t) => t.href === sourceUrl);
          if (!linksBack) missing.push(tag.hreflang);
        }
        if (missing.length > 0) hreflangMissingByUrl.set(sourceUrl, missing);
      }

      // Detect near-duplicates: group observations by content_hash. For any group
      // with 2+ URLs, pick the shortest URL as "canonical" and mark every other
      // URL in the group as duplicate-of-canonical. T009 fires on the marked ones.
      const byContentHash = new Map<string, string[]>();
      for (const o of observations) {
        if (!o.contentHash) continue;
        const list = byContentHash.get(o.contentHash) ?? [];
        list.push(o.url);
        byContentHash.set(o.contentHash, list);
      }
      const duplicateOfByUrl = new Map<string, string>();
      for (const [, urls] of byContentHash) {
        if (urls.length < 2) continue;
        const canonical = [...urls].sort((a, b) => a.length - b.length)[0]!;
        for (const u of urls) if (u !== canonical) duplicateOfByUrl.set(u, canonical);
      }

      let evaluationsInserted = 0;
      let findingsUpserted = 0;

      const enabledRules = await db.query<{ ruleId: string }>(ctx, sql`SELECT rule_id FROM registry_seo_rule WHERE organization_id = ${ctx.organizationId} AND active = true AND tested = true`);
      const enabledRuleIds = new Set(enabledRules.map(rule => rule.ruleId));
      const hydrationMaps: HydrationMaps = {
        outboundBySourceHash,
        inboundInternalCountByTargetHash,
        sitemapByUrl,
        hreflangMissingByUrl,
        duplicateOfByUrl,
        clicksByUrl,
        lhScoreByUrl,
        seedUrlHashes,
        originCruxLcp,
        originCruxInp,
        originCruxCls,
        nowMs: now,
      };

      for (const row of observations) {
        const observation = hydrateObservation(row, hydrationMaps);

        const results = evaluateAll(observation).filter(result => enabledRuleIds.has(result.ruleId));

        await db.transaction(ctx, async (tx) => {
          for (const result of results) {
            await tx.query(sql`
              INSERT INTO seo_rule_evaluations
                (id, organization_id, scan_run_id, page_obs_id, rule_id, rule_version,
                 result, severity, confidence, affected_target, evidence, proposed_fix)
              VALUES
                (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${row.id},
                 ${result.ruleId}, ${result.ruleVersion}, ${result.result}, ${result.severity},
                 ${result.confidence}, ${result.affectedTarget},
                 ${JSON.stringify(result.evidence)}::jsonb, ${result.proposedFix})
            `);
            evaluationsInserted++;

            if (result.result !== 'fail' && result.result !== 'review') continue;

            const signature = signatureFor(result.ruleId, result.affectedTarget);
            const findingId = randomUUID();
            const affectedUrl = result.affectedTarget ?? row.url;
            const clicksForUrl = clicksByUrl.get(affectedUrl) ?? 0;
            const priorityScore = computePriorityScore(result.severity, result.confidence, clicksForUrl);
            const upserted = await tx.one<{ id: string; inserted: boolean }>(sql`
              INSERT INTO seo_findings
                (id, site_id, organization_id, rule_id, rule_version, signature,
                 affected_target, status, severity, confidence, priority_score,
                 first_seen_run, latest_run, first_seen_at, last_seen_at)
              VALUES
                (${findingId}, ${siteId}, ${ctx.organizationId}, ${result.ruleId}, ${result.ruleVersion},
                 ${signature}, ${result.affectedTarget ?? row.url}, 'open', ${result.severity},
                 ${result.confidence}, ${priorityScore}, ${scanRunId}, ${scanRunId}, now(), now())
              ON CONFLICT (site_id, signature) DO UPDATE SET
                latest_run = ${scanRunId},
                last_seen_at = now(),
                severity = EXCLUDED.severity,
                confidence = EXCLUDED.confidence,
                priority_score = EXCLUDED.priority_score,
                resolved_at = NULL,
                resolution_run = NULL,
                status = CASE WHEN seo_findings.status IN ('verified_resolved', 'false_positive', 'accepted_exception')
                              THEN 'reopened'
                              ELSE seo_findings.status END
              RETURNING id, (xmax = 0) AS inserted
            `);

            await tx.query(sql`
              INSERT INTO seo_finding_instances
                (id, finding_id, scan_run_id, organization_id, affected_url, evidence)
              VALUES
                (${randomUUID()}, ${upserted.id}, ${scanRunId}, ${ctx.organizationId},
                 ${result.affectedTarget ?? row.url}, ${JSON.stringify(result.evidence)}::jsonb)
              ON CONFLICT (finding_id, scan_run_id, affected_url) DO UPDATE SET
                last_seen_at = now()
            `);

            // Materialize the rule's proposedFix text as a draft fix proposal so
            // Fix Studio has something to show. Skip if an open draft already
            // exists for this finding — re-scans shouldn't spam duplicates.
            if (result.proposedFix) {
              const existingDraft = await tx.maybeOne<{ id: string }>(sql`
                SELECT id FROM seo_fix_proposals
                WHERE finding_id = ${upserted.id}
                  AND status IN ('draft', 'pending_review')
                LIMIT 1
              `);
              if (!existingDraft) {
                await tx.query(sql`
                  INSERT INTO seo_fix_proposals
                    (id, finding_id, organization_id, target_integration,
                     diff_preview, status, proposed_by)
                  VALUES
                    (${randomUUID()}, ${upserted.id}, ${ctx.organizationId}, 'manual',
                     ${result.proposedFix}, 'draft', ${SYSTEM_ID}::uuid)
                `);
              }
            }

            findingsUpserted++;
          }
        });
      }

      const openFindings = await db.one<{ n: string }>(ctx, sql`
        SELECT COUNT(DISTINCT f.id)::text AS n
        FROM seo_findings f
        JOIN seo_finding_instances fi ON fi.finding_id = f.id AND fi.scan_run_id = ${scanRunId}
        WHERE f.organization_id = ${ctx.organizationId} AND f.site_id = ${siteId}
      `);

      // Dispatch alerts for findings that need owner attention: new high/critical
      // issues from this scan, and findings that just reopened after being resolved.
      const newHighSeverity = await db.query<{
        id: string; ruleId: string; severity: 'critical' | 'high'; affectedTarget: string;
      }>(ctx, sql`
        SELECT id, rule_id, severity, affected_target
        FROM seo_findings
        WHERE organization_id = ${ctx.organizationId}
          AND site_id = ${siteId}
          AND first_seen_run = ${scanRunId}
          AND severity IN ('critical', 'high')
          AND status = 'open'
      `);

      const reopened = await db.query<{
        id: string; ruleId: string; severity: string; affectedTarget: string;
      }>(ctx, sql`
        SELECT id, rule_id, severity, affected_target
        FROM seo_findings
        WHERE organization_id = ${ctx.organizationId}
          AND site_id = ${siteId}
          AND latest_run = ${scanRunId}
          AND status = 'reopened'
      `);

      for (const f of newHighSeverity) {
        const triggerType = f.severity === 'critical' ? 'Critical issue detected' : 'High-priority issue detected';
        await db.query(ctx, sql`
          INSERT INTO seo_alerts
            (id, site_id, organization_id, trigger_type, dedup_key, severity, message, metadata)
          VALUES
            (${randomUUID()}, ${siteId}, ${ctx.organizationId}, ${triggerType},
             ${`new:${f.id}`}, ${f.severity},
             ${`Rule ${f.ruleId} fired on ${f.affectedTarget}`},
             ${JSON.stringify({ findingId: f.id, ruleId: f.ruleId, scanRunId })}::jsonb)
          ON CONFLICT (site_id, dedup_key) DO NOTHING
        `);
      }

      for (const f of reopened) {
        const alertSeverity = (f.severity === 'informational' ? 'low' : f.severity);
        await db.query(ctx, sql`
          INSERT INTO seo_alerts
            (id, site_id, organization_id, trigger_type, dedup_key, severity, message, metadata)
          VALUES
            (${randomUUID()}, ${siteId}, ${ctx.organizationId}, 'Issue reopened',
             ${`reopen:${f.id}:${scanRunId}`}, ${alertSeverity},
             ${`Rule ${f.ruleId} is firing again on ${f.affectedTarget} after previously being marked resolved`},
             ${JSON.stringify({ findingId: f.id, ruleId: f.ruleId, scanRunId })}::jsonb)
          ON CONFLICT (site_id, dedup_key) DO NOTHING
        `);
      }

      await db.query(ctx, sql`
        UPDATE seo_scan_runs
        SET status = CASE WHEN fetched_count = 0 THEN 'failed' WHEN failed_count + skipped_count > 0 OR discovered_count >= (SELECT max_pages FROM seo_scan_configs WHERE id = seo_scan_runs.config_id) THEN 'completed_partial' ELSE 'completed' END,
            termination_reason = CASE WHEN fetched_count = 0 THEN 'No pages could be audited. Check website access and robots.txt.' WHEN discovered_count >= (SELECT max_pages FROM seo_scan_configs WHERE id = seo_scan_runs.config_id) THEN 'The configured page limit was reached.' ELSE NULL END,
            ended_at = now(),
            findings_count = ${parseInt(openFindings.n, 10)}
        WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
      `);

      // Trigger a CrUX fetch for this site so the CWV panel refreshes without
      // waiting for the next daily tick. Fire-and-forget: CrUX failures must not
      // fail the evaluate job (which has already committed its findings).
      if (cruxFetchHandle) {
        await cruxFetchHandle.enqueue({
          organizationId: ctx.organizationId,
          key: `seo:crux:${siteId}:${scanRunId}`,
          payload: { organizationId: ctx.organizationId, siteId },
        });
      }
      // Also enqueue a Lighthouse pass for the top URLs; slower than CrUX so run
      // as a separate job rather than inline.
      if (lighthouseAuditHandle) {
        await lighthouseAuditHandle.enqueue({
          organizationId: ctx.organizationId,
          key: `seo:lighthouse:${siteId}:${scanRunId}`,
          payload: { organizationId: ctx.organizationId, siteId },
        });
      }

      void evaluationsInserted;
      void findingsUpserted;
      return { itemsProcessed: observations.length };
    }),
  });

  cruxFetchHandle = defineJob<SeoJobPayload>({
    name: 'seo:crux_fetch',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 3,
    backoffMs: 5 * 60_000,
    handler: async ({ ctx, payload }) => {
      // Payload can target a single site; omitted = every active site in the org
      const targetSiteId = (payload as SeoJobPayload | undefined)?.siteId;

      const sites = targetSiteId
        ? await db.query<{ id: string; displayUrl: string }>(ctx, sql`
            SELECT id, display_url FROM seo_sites
            WHERE organization_id = ${ctx.organizationId} AND id = ${targetSiteId} AND active = true
          `)
        : await db.query<{ id: string; displayUrl: string }>(ctx, sql`
            SELECT id, display_url FROM seo_sites
            WHERE organization_id = ${ctx.organizationId} AND active = true
          `);

      let persisted = 0;

      for (const site of sites) {
        persisted += await refreshCrux(ctx, site.id, site.displayUrl);
      }

      return { itemsProcessed: persisted };
    },
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

      const site = await db.maybeOne<{ id: string; displayUrl: string }>(ctx, sql`
        SELECT id, display_url FROM seo_sites
        WHERE organization_id = ${ctx.organizationId} AND id = ${siteId} AND active = true
      `);
      if (!site) return { itemsProcessed: 0 };

      // Audit at most 5 URLs per run: homepage + top-4 by GSC clicks (28d).
      // Lighthouse is slow (~30s each) and PSI's free quota is bounded; this
      // bounds cost without missing the business-critical pages.
      const topUrls = await db.query<{ url: string }>(ctx, sql`
        SELECT page AS url, SUM(clicks)::integer AS total_clicks
        FROM seo_gsc_metrics
        WHERE organization_id = ${ctx.organizationId}
          AND site_id = ${siteId}
          AND page IS NOT NULL
          AND date >= (current_date - interval '28 days')::date
        GROUP BY page
        ORDER BY total_clicks DESC
        LIMIT 4
      `);
      const urls = new Set<string>((payload.extra?.['homepageOnly'] === true
        ? [site.displayUrl]
        : [site.displayUrl, ...topUrls.map((r) => r.url)]).map(url => new URL(url).toString()));

      let audited = 0;
      for (const url of urls) {
        audited += await refreshLighthouse(ctx, siteId, url);
      }

      return { itemsProcessed: audited };
    },
  });

  serpObserveHandle = defineJob<SeoJobPayload>({
    name: 'seo:serp_observe',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 3,
    backoffMs: 5 * 60_000,
    handler: async ({ ctx, payload }) => {
      const targetSiteId = (payload as SeoJobPayload | undefined)?.siteId;
      const sites = await db.query<{ id: string }>(ctx, sql`
        SELECT id FROM seo_sites WHERE organization_id = ${ctx.organizationId} AND active = true
          AND (${targetSiteId ?? null}::uuid IS NULL OR id = ${targetSiteId ?? null}::uuid)
      `);
      let observed = 0;
      for (const site of sites) observed += await checkSiteRanks(ctx, site.id);
      return { itemsProcessed: observed };
    },
  });

  gscSyncHandle = defineJob<SeoJobPayload>({
    name: 'seo:gsc_sync',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 3,
    backoffMs: 5 * 60_000,
    handler: async ({ ctx }) => {
      const sites = await db.query<{ id: string; displayUrl: string }>(ctx, sql`
        SELECT id, display_url FROM seo_sites
        WHERE organization_id = ${ctx.organizationId} AND active = true
      `);

      let synced = 0;
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      for (const site of sites) {
        if (!googleAuthConfigured()) continue;
        const result = await importGscPerformance(ctx, site.id, site.displayUrl, startDate, endDate);
        synced += result.synced;

        // After GSC data lands, harvest the top queries as tracked keywords so the
        // Rank Tracking panel (fed by seo:serp_observe) has something to track.
        await harvestKeywordsFromGsc(ctx, site.id);
      }

      return { itemsProcessed: synced };
    },
  });

  backlinksFetchHandle = defineJob<SeoJobPayload>({
    name: 'seo:backlinks_fetch',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 2,
    backoffMs: 30 * 60_000,
    handler: async ({ ctx, payload }) => {
      const targetSiteId = (payload as SeoJobPayload | undefined)?.siteId;
      const sites = targetSiteId
        ? await db.query<{ id: string; displayUrl: string; normalizedHost: string }>(ctx, sql`
            SELECT id, display_url, normalized_host FROM seo_sites
            WHERE organization_id = ${ctx.organizationId}
              AND id = ${targetSiteId}
              AND active = true
          `)
        : await db.query<{ id: string; displayUrl: string; normalizedHost: string }>(ctx, sql`
            SELECT id, display_url, normalized_host FROM seo_sites
            WHERE organization_id = ${ctx.organizationId} AND active = true
          `);

      let inserted = 0;

      for (const site of sites) {
        const result = await mozFetchBacklinks(site.normalizedHost);
        if (result.state !== 'ok' || !result.data) continue;

        for (const link of result.data.links) {
          const dr = link.domainAuthority;
          const firstSeen = link.firstSeen;
          const rows = await db.query<{ id: string }>(ctx, sql`
            INSERT INTO seo_backlinks
              (id, site_id, organization_id, source_url, source_domain,
               target_url, anchor_text, rel_values, provider, confidence,
               domain_rating, first_seen_at, last_seen_at)
            VALUES
              (${randomUUID()}, ${site.id}, ${ctx.organizationId},
               ${link.sourceUrl}, ${link.sourceDomain},
               ${link.targetUrl}, ${link.anchorText}, ${link.relValues}::text[],
               'moz', 'direct',
               ${dr}, ${firstSeen}, now())
            ON CONFLICT (site_id, source_url, target_url) DO UPDATE SET
              anchor_text = EXCLUDED.anchor_text,
              rel_values = EXCLUDED.rel_values,
              domain_rating = EXCLUDED.domain_rating,
              last_seen_at = now()
            RETURNING id
          `);
          inserted += rows.length;
        }
      }

      return { itemsProcessed: inserted };
    },
  });

  aiVisibilityObserveHandle = defineJob<SeoJobPayload>({
    name: 'seo:ai_visibility_observe',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 2,
    backoffMs: 30 * 60_000,
    handler: async ({ ctx, payload }) => {
      const targetSiteId = (payload as SeoJobPayload | undefined)?.siteId;
      const sites = targetSiteId
        ? await db.query<{ id: string; displayUrl: string; normalizedHost: string }>(ctx, sql`
            SELECT id, display_url, normalized_host FROM seo_sites
            WHERE organization_id = ${ctx.organizationId}
              AND id = ${targetSiteId}
              AND active = true
          `)
        : await db.query<{ id: string; displayUrl: string; normalizedHost: string }>(ctx, sql`
            SELECT id, display_url, normalized_host FROM seo_sites
            WHERE organization_id = ${ctx.organizationId} AND active = true
          `);

      // Prefer Perplexity when the key is set (richer answers + off-Google
      // coverage); otherwise fall back to Google AI Overviews via the existing
      // SerpAPI key. Both implement the same AISearchProvider interface so the
      // rest of the loop stays identical.
      const providerName = process.env['PERPLEXITY_API_KEY'] ? 'perplexity' : 'serpapi-ai-overview';
      const provider = providerName === 'perplexity'
        ? createPerplexityProvider()
        : createSerpApiAiOverviewProvider();
      let observed = 0;

      for (const site of sites) {
        await ensureDefaultPromptSet(ctx, site.id, site.normalizedHost);

        // Pull prompts due for observation. Cadence rules match the SERP job:
        // skip prompts whose last observation is still within their cadence.
        const duePrompts = await db.query<{
          promptId: string; promptSetId: string; promptText: string;
          brandAliases: string[]; platforms: string[]; locale: string;
        }>(ctx, sql`
          SELECT p.id AS prompt_id, ps.id AS prompt_set_id, p.prompt_text,
                 ps.brand_aliases, ps.platforms, ps.locale
          FROM seo_ai_prompts p
          JOIN seo_ai_prompt_sets ps ON ps.id = p.prompt_set_id
          WHERE p.organization_id = ${ctx.organizationId}
            AND ps.site_id = ${site.id}
            AND p.active = true
            AND ps.active = true
            AND ps.cadence IN ('daily', 'weekly', 'monthly')
            AND NOT EXISTS (
              SELECT 1 FROM seo_ai_observations o
              WHERE o.prompt_id = p.id
                AND o.observed_at > now() - (
                  CASE ps.cadence
                    WHEN 'daily' THEN interval '1 day'
                    WHEN 'weekly' THEN interval '7 days'
                    WHEN 'monthly' THEN interval '30 days'
                  END
                )
            )
        `);

        for (const kw of duePrompts) {
          const platforms = kw.platforms.length > 0 ? kw.platforms : ['perplexity'];
          for (const platform of platforms) {
            const result = await provider.observe({
              prompt: kw.promptText,
              platform,
              locale: kw.locale,
              language: kw.locale.split('-')[0] ?? 'en',
              brandAliases: kw.brandAliases,
              domain: site.normalizedHost,
            });

            const state =
              result.state === 'not_configured' ? 'failed' :
              result.state === 'provider_error' ? 'failed' : 'success';

            await db.query(ctx, sql`
              INSERT INTO seo_ai_observations
                (id, prompt_id, site_id, organization_id, provider, platform, locale,
                 brand_mentioned, domain_cited, citation_urls, competitor_mentions, state)
              VALUES
                (${randomUUID()}, ${kw.promptId}, ${site.id}, ${ctx.organizationId},
                 ${providerName}, ${platform}, ${kw.locale},
                 ${result.data?.brandMentioned ?? null},
                 ${result.data?.domainCited ?? null},
                 ${result.data?.citationUrls ?? []}::text[],
                 ${JSON.stringify(result.data?.competitorMentions ?? [])}::jsonb,
                 ${state})
            `);
            observed++;
          }
        }
      }

      return { itemsProcessed: observed };
    },
  });

  schedulerHandle = defineJob<SeoJobPayload>({
    name: 'seo:scheduler',
    perOrganization: true,
    module: 'seo-intelligence',
    schedule: { every: 24 * 60 * 60_000 },
    attempts: 2,
    backoffMs: 60 * 60_000,
    handler: async ({ ctx }) => {
      // Pick sites that have no in-flight scan and whose last completed scan is
      // older than 7 days (or never happened). Trigger a fresh scan for each.
      // In-flight statuses hold the queue; completed/failed/cancelled don't.
      const dueSites = await db.query<{ id: string }>(ctx, sql`
        SELECT s.id FROM seo_sites s
        WHERE s.organization_id = ${ctx.organizationId}
          AND s.active = true
          AND NOT EXISTS (
            SELECT 1 FROM seo_scan_runs r
            WHERE r.site_id = s.id
              AND r.status IN ('queued', 'discovering', 'fetching', 'rendering', 'evaluating', 'aggregating')
          )
          AND NOT EXISTS (
            SELECT 1 FROM seo_scan_runs r
            WHERE r.site_id = s.id
              AND r.status IN ('completed', 'completed_partial')
              AND r.ended_at > now() - interval '7 days'
          )
      `);

      let triggered = 0;

      for (const { id: siteId } of dueSites) {
        // Reuse the same shape as the service's triggerScan but inline to avoid a
        // service→jobs→service import cycle. Config fallback mirrors triggerScan.
        const configRow = await db.maybeOne<{ id: string }>(ctx, sql`
          SELECT id FROM seo_scan_configs
          WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
          ORDER BY created_at DESC LIMIT 1
        `);
        const configId = configRow?.id ?? randomUUID();
        const scanRunId = randomUUID();

        await db.transaction(ctx, async (tx) => {
          if (!configRow) {
            await tx.query(sql`
              INSERT INTO seo_scan_configs
                (id, organization_id, site_id)
              VALUES (${configId}, ${ctx.organizationId}, ${siteId})
            `);
          }
          await tx.query(sql`
            INSERT INTO seo_scan_runs
              (id, organization_id, site_id, config_id, status, triggered_by, queued_at)
            VALUES
              (${scanRunId}, ${ctx.organizationId}, ${siteId}, ${configId},
               'queued', ${SYSTEM_ID}::uuid, now())
          `);
        });

        if (crawlDiscoverHandle) {
          await crawlDiscoverHandle.enqueue({
            organizationId: ctx.organizationId,
            key: `seo:discover:${scanRunId}`,
            payload: { organizationId: ctx.organizationId, siteId, scanRunId },
          });
        }
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
  // Default platform set covers whichever AI providers the tenant has keys
  // for. Admins can edit the set later to add/remove platforms.
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
      INSERT INTO seo_ai_prompts
        (id, prompt_set_id, organization_id, prompt_text, active)
      VALUES
        (${randomUUID()}, ${setId}, ${ctx.organizationId}, ${prompt}, true)
    `);
  }
}

export { normalizeKeywordDevice } from './gsc-keywords.js';
