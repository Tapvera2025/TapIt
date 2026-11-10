import { randomUUID } from 'node:crypto';
import { getSeoRuleCopy } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { safeFetch, RedirectLoopError, crawlerUserAgent, type FetchResult, type FetchHop } from './crawler/http.js';
import { HostNotFoundError, SsrfBlockedError } from './crawler/ssrf-guard.js';
import { parseHtml, rawSignalsOf } from './crawler/parse.js';
import { renderPage, shouldRender } from './crawler/render.js';
import { loadRobotsPolicy, type RobotsPolicy } from './crawler/robots-policy.js';
import { fetchSitemap, discoverSitemapUrls, parseLastmod, parsePriority } from './crawler/sitemap.js';
import {
  evaluateAll, evaluateSiteRules, getActiveRules, isEvaluablePage,
  type PageObservation, type RuleResult, type CwvRating,
} from './crawler/rules/index.js';
import { computePriorityScore } from './priority.js';
import { hydrateObservation, type HydrationMaps, type ObservationRow } from './hydrate.js';
import { configForRun, type ScanConfig } from './scan-config.js';
import {
  hashUrl, hostKey, inScope, isHtmlContentType, isRelatedHost, normalizeUrl, urlHostKey,
} from './url.js';

/**
 * The checkup pipeline: discover → fetch (in batches) → evaluate.
 *
 * Every URL is stored under its normalized spelling, so a page is crawled and
 * reported once. A redirect is recorded on the URL that redirects (status
 * 301/302…) and the destination's content is recorded under the destination.
 * Content checks only run on pages that loaded as HTML.
 */

export const FETCH_BATCH_SIZE = 10;
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
/** Raw page data (observations, links, sitemap rows, evaluations) is kept for this many latest checkups per site. */
export const RAW_SCANS_KEPT = 3;
const UNRESOLVED = ['open', 'assigned', 'in_progress', 'ready_for_verification', 'reopened'] as const;

interface SiteRow {
  id: string;
  displayUrl: string;
  normalizedHost: string;
  scopePath: string | null;
}

async function loadSite(ctx: RequestContext, siteId: string): Promise<SiteRow> {
  return db.one<SiteRow>(ctx, sql`
    SELECT id, display_url, normalized_host, scope_path FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND id = ${siteId}
  `);
}

/** The site's start page: its address plus any scope path. */
export function startUrl(site: Pick<SiteRow, 'displayUrl' | 'scopePath'>): string {
  const scope = site.scopePath && site.scopePath !== '/' ? site.scopePath : '/';
  return normalizeUrl(scope, site.displayUrl) ?? normalizeUrl(site.displayUrl) ?? site.displayUrl;
}

/** Returns true if `url` matches any exclusion pattern (`*` wildcards, otherwise a substring). */
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

function signatureFor(ruleId: string, affectedTarget: string | null): string {
  return hashUrl(`${ruleId}::${affectedTarget ?? 'site'}`);
}

// ─── Discover ────────────────────────────────────────────────────────────────

export async function discoverScan(ctx: RequestContext, siteId: string, scanRunId: string): Promise<number> {
  await db.query(ctx, sql`
    UPDATE seo_scan_runs SET status = 'discovering', started_at = COALESCE(started_at, now())
    WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
  `);
  const site = await loadSite(ctx, siteId);
  const config = await configForRun(ctx, scanRunId);
  const siteKey = hostKey(site.normalizedHost);

  const seedRows = await db.query<{ url: string }>(ctx, sql`
    SELECT input_url AS url FROM seo_site_seeds
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
    ORDER BY is_priority DESC, added_at LIMIT 50
  `);
  const seeds = [...new Set(
    [startUrl(site), ...seedRows.map((row) => normalizeUrl(row.url, site.displayUrl))]
      .filter((url): url is string => url !== null),
  )].slice(0, config.maxPages);
  await queueUrls(ctx, scanRunId, seeds, 'seed');

  let sitemapQueued = 0;
  if (config.followSitemaps) {
    const entries = new Map<string, { lastmod: string | null; changefreq: string | null; priority: number | null; source: string }>();
    for (const sitemapUrl of await discoverSitemapUrls(site.displayUrl)) {
      const { entries: found } = await fetchSitemap(sitemapUrl);
      for (const entry of found) {
        const url = normalizeUrl(entry.url);
        if (!url || entries.has(url) || urlHostKey(url) !== siteKey) continue;
        entries.set(url, {
          lastmod: parseLastmod(entry.lastmod),
          changefreq: entry.changefreq ? entry.changefreq.slice(0, 32) : null,
          priority: parsePriority(entry.priority),
          source: sitemapUrl,
        });
        if (entries.size >= 50_000) break;
      }
      if (entries.size >= 50_000) break;
    }
    // Every sitemap URL is recorded — including the start page — so "missing from
    // the sitemap" is judged against the whole sitemap, not the crawl budget.
    const all = [...entries.entries()];
    for (let i = 0; i < all.length; i += 1000) {
      const chunk = all.slice(i, i + 1000);
      await db.query(ctx, sql`
        INSERT INTO seo_sitemap_entries
          (id, scan_run_id, organization_id, site_id, url, url_hash, lastmod, changefreq, priority, sitemap_source)
        SELECT gen_random_uuid(), ${scanRunId}, ${ctx.organizationId}, ${siteId}, e.url, e.hash,
               e.lastmod, e.changefreq, e.priority, e.source
        FROM unnest(${chunk.map(([url]) => url)}::text[], ${chunk.map(([url]) => hashUrl(url))}::text[],
                    ${chunk.map(([, e]) => e.lastmod)}::timestamptz[], ${chunk.map(([, e]) => e.changefreq)}::text[],
                    ${chunk.map(([, e]) => e.priority)}::numeric[], ${chunk.map(([, e]) => e.source)}::text[])
          AS e(url, hash, lastmod, changefreq, priority, source)
        ON CONFLICT (scan_run_id, url_hash) DO NOTHING
      `);
    }
    const budget = Math.max(0, config.maxPages - seeds.length);
    const toQueue = all
      .map(([url]) => url)
      .filter((url) => !seeds.includes(url) && inScope(url, site.scopePath) && !isExcluded(url, config.exclusionPatterns))
      .slice(0, budget);
    sitemapQueued = await queueUrls(ctx, scanRunId, toQueue, 'sitemap');
  }

  const discovered = await knownUrlCount(ctx, scanRunId);
  await db.query(ctx, sql`
    UPDATE seo_scan_runs SET status = 'fetching', discovered_count = ${discovered}
    WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
  `);
  return seeds.length + sitemapQueued;
}

async function queueUrls(ctx: RequestContext, scanRunId: string, urls: readonly string[], source: string): Promise<number> {
  if (urls.length === 0) return 0;
  const rows = await db.query<{ id: string }>(ctx, sql`
    INSERT INTO seo_scan_url_states (id, organization_id, scan_run_id, url, url_hash, discovery_source, state)
    SELECT gen_random_uuid(), ${ctx.organizationId}, ${scanRunId}, u.url, u.hash, ${source}, 'queued'
    FROM unnest(${[...urls]}::text[], ${urls.map(hashUrl)}::text[]) AS u(url, hash)
    ON CONFLICT (scan_run_id, url_hash) DO NOTHING
    RETURNING id
  `);
  return rows.length;
}

async function knownUrlCount(ctx: RequestContext, scanRunId: string): Promise<number> {
  const row = await db.one<{ n: number }>(ctx, sql`
    SELECT count(*)::integer AS n FROM seo_scan_url_states
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);
  return row.n;
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

interface CrawlState {
  ctx: RequestContext;
  scanRunId: string;
  site: SiteRow;
  config: ScanConfig;
  hosts: Set<string>;
  robots: Map<string, RobotsPolicy>;
  userAgent: string;
  renderedSoFar: number;
  counters: { fetched: number; failed: number; skipped: number; rendered: number };
}

/** Hosts this crawl treats as the website: the site's own, plus where its start page redirects within the same domain. */
async function crawlHosts(ctx: RequestContext, scanRunId: string, site: SiteRow): Promise<Set<string>> {
  const hosts = new Set([hostKey(site.normalizedHost)]);
  const rows = await db.query<{ redirectTarget: string }>(ctx, sql`
    SELECT redirect_target FROM seo_scan_url_states
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
      AND discovery_source = 'seed' AND redirect_target IS NOT NULL
  `);
  for (const row of rows) {
    const key = urlHostKey(row.redirectTarget);
    if (key && isRelatedHost(site.normalizedHost, key)) hosts.add(key);
  }
  return hosts;
}

/** Fetches one batch. Returns false when the queue is empty. */
export async function fetchBatch(ctx: RequestContext, siteId: string, scanRunId: string): Promise<boolean> {
  const site = await loadSite(ctx, siteId);
  const config = await configForRun(ctx, scanRunId);
  // Claim atomically: a statement-level lock is the only kind that holds here.
  // A batch that died mid-way is picked up again after 15 minutes.
  const claimed = await db.query<{ id: string; url: string; discoverySource: string }>(ctx, sql`
    UPDATE seo_scan_url_states SET state = 'fetching', updated_at = now()
    WHERE id IN (
      SELECT id FROM seo_scan_url_states
      WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
        AND (state = 'queued' OR (state = 'fetching' AND updated_at < now() - interval '15 minutes'))
      ORDER BY updated_at, id
      LIMIT ${FETCH_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, url, discovery_source
  `);
  if (claimed.length === 0) return false;

  const rendered = await db.one<{ n: number }>(ctx, sql`
    SELECT count(*)::integer AS n FROM seo_page_observations
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId} AND render_mode = 'both'
  `);
  const state: CrawlState = {
    ctx, scanRunId, site, config,
    hosts: await crawlHosts(ctx, scanRunId, site),
    robots: new Map(),
    userAgent: crawlerUserAgent(config.crawlerIdentity),
    renderedSoFar: rendered.n,
    counters: { fetched: 0, failed: 0, skipped: 0, rendered: 0 },
  };

  for (const row of claimed) {
    try {
      await crawlUrl(state, row);
    } catch (error) {
      // One bad URL never ends the checkup: record why and move on.
      const safety = error instanceof SsrfBlockedError && !(error instanceof HostNotFoundError);
      const reason = describeFetchError(error);
      await markUrl(ctx, row.id, safety ? 'safety_rejected' : 'failed', null, { reason });
      if (safety) state.counters.skipped++;
      else state.counters.failed++;
    }
  }

  await db.query(ctx, sql`
    UPDATE seo_scan_runs
    SET fetched_count = fetched_count + ${state.counters.fetched},
        failed_count = failed_count + ${state.counters.failed},
        skipped_count = skipped_count + ${state.counters.skipped},
        rendered_count = rendered_count + ${state.counters.rendered},
        discovered_count = (SELECT count(*) FROM seo_scan_url_states s
                            WHERE s.organization_id = ${ctx.organizationId} AND s.scan_run_id = ${scanRunId})
    WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
  `);
  return true;
}

function describeFetchError(error: unknown): string {
  if (error instanceof HostNotFoundError) return `The address ${error.hostname} could not be found (DNS).`;
  if (error instanceof SsrfBlockedError) return error.message.slice(0, 500);
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'The page could not be fetched.';
}

async function robotsFor(state: CrawlState, url: string): Promise<RobotsPolicy | null> {
  if (!state.config.respectRobots) return null;
  const origin = new URL(url).origin;
  let policy = state.robots.get(origin);
  if (!policy) {
    policy = await loadRobotsPolicy(origin, state.userAgent);
    state.robots.set(origin, policy);
  }
  return policy;
}

async function crawlUrl(state: CrawlState, row: { id: string; url: string; discoverySource: string }): Promise<void> {
  const { ctx, config } = state;
  const policy = await robotsFor(state, row.url);
  if (policy && !policy.allows(row.url)) {
    await markUrl(ctx, row.id, 'disallowed', null, { reason: policy.reason });
    state.counters.skipped++;
    return;
  }
  const delay = Math.max(config.crawlDelayMs, policy?.delayMs ?? 0);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  let result: FetchResult;
  try {
    result = await safeFetch(row.url, {
      userAgent: state.userAgent,
      htmlOnly: true,
      maxBytes: config.maxBytesPerPage,
    });
  } catch (error) {
    if (!(error instanceof RedirectLoopError)) throw error;
    await recordRedirect(state, row.url, error.chain, null, 0);
    await markUrl(ctx, row.id, 'failed', error.chain[0]?.status ?? null, {
      reason: 'The URL redirects in a loop or through too many steps.',
    });
    state.counters.failed++;
    return;
  }

  const finalUrl = normalizeUrl(result.finalUrl) ?? result.finalUrl;
  if (result.redirectChain.length === 0 || finalUrl === row.url) {
    await recordPage(state, row.url, row.id, { ...result, redirectChain: [] });
    return;
  }

  // The URL redirects: record that on the URL itself, then audit the destination once.
  const first = result.redirectChain[0]!;
  await recordRedirect(state, row.url, result.redirectChain, finalUrl, result.elapsedMs);
  await markUrl(ctx, row.id, 'fetched', first.status, { redirectTarget: finalUrl });
  state.counters.fetched++;

  const targetKey = urlHostKey(finalUrl);
  if (targetKey === null) return;
  if (!state.hosts.has(targetKey)) {
    // A start page moving to www., or to a subdomain, is the same website.
    if (row.discoverySource !== 'seed' || !isRelatedHost(state.site.normalizedHost, targetKey)) return;
    state.hosts.add(targetKey);
  }
  if (!inScope(finalUrl, state.site.scopePath) && row.discoverySource !== 'seed') return;
  if (isExcluded(finalUrl, config.exclusionPatterns)) return;
  const targetPolicy = await robotsFor(state, finalUrl);
  const target = await claimRedirectTarget(ctx, state.scanRunId, finalUrl);
  if (!target) return; // already crawled or being crawled on its own
  if (targetPolicy && !targetPolicy.allows(finalUrl)) {
    await markUrl(ctx, target, 'disallowed', null, { reason: targetPolicy.reason });
    state.counters.skipped++;
    return;
  }
  await recordPage(state, finalUrl, target, { ...result, redirectChain: [] });
}

/** Takes ownership of a redirect destination unless it is already being crawled. Returns its url-state id. */
async function claimRedirectTarget(ctx: RequestContext, scanRunId: string, url: string): Promise<string | null> {
  const row = await db.maybeOne<{ id: string }>(ctx, sql`
    INSERT INTO seo_scan_url_states (id, organization_id, scan_run_id, url, url_hash, discovery_source, state)
    VALUES (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${url}, ${hashUrl(url)}, 'redirect', 'fetching')
    ON CONFLICT (scan_run_id, url_hash) DO UPDATE SET state = 'fetching', updated_at = now()
      WHERE seo_scan_url_states.state = 'queued'
    RETURNING id
  `);
  return row?.id ?? null;
}

async function markUrl(
  ctx: RequestContext,
  id: string,
  state: 'fetched' | 'failed' | 'disallowed' | 'safety_rejected' | 'skipped',
  httpStatus: number | null,
  extra: { reason?: string; redirectTarget?: string } = {},
): Promise<void> {
  await db.query(ctx, sql`
    UPDATE seo_scan_url_states
    SET state = ${state}, http_status = COALESCE(${httpStatus}::integer, http_status),
        rejection_reason = ${extra.reason ?? null}, redirect_target = ${extra.redirectTarget ?? null},
        retry_count = retry_count + ${state === 'failed' ? 1 : 0}, updated_at = now()
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
}

async function recordRedirect(
  state: CrawlState,
  url: string,
  chain: FetchHop[],
  finalUrl: string | null,
  elapsedMs: number,
): Promise<void> {
  await upsertObservation(state.ctx, state.scanRunId, {
    url,
    httpStatus: chain[0]?.status ?? null,
    finalUrl,
    redirectChain: chain.map((hop) => ({ url: hop.url, status: hop.status })),
    contentType: null,
    contentLength: null,
    responseTimeMs: elapsedMs,
  });
}

async function recordPage(state: CrawlState, url: string, urlStateId: string, result: FetchResult): Promise<void> {
  const { ctx, config, scanRunId } = state;
  const contentType = result.headers['content-type'] ?? null;
  const loaded = result.status >= 200 && result.status < 300;
  const html = loaded && !result.bodySkipped && (isHtmlContentType(contentType) || /^\s*<(!doctype html|html)\b/i.test(result.body));

  if (!html) {
    // Error pages, PDFs, images: their status matters, their body does not.
    await upsertObservation(ctx, scanRunId, {
      url,
      httpStatus: result.status,
      finalUrl: url,
      redirectChain: [],
      contentType: contentType ?? (loaded ? 'application/octet-stream' : null),
      contentLength: result.byteLength,
      responseTimeMs: result.elapsedMs,
      xRobotsTag: result.headers['x-robots-tag'] ?? null,
      cacheControl: result.headers['cache-control'] ?? null,
    });
    await markUrl(ctx, urlStateId, 'fetched', result.status);
    state.counters.fetched++;
    return;
  }

  let obs = parseHtml({ siteHosts: state.hosts, fetch: result, url });
  let renderMode: 'raw' | 'both' = 'raw';
  let domHash: string | null = null;
  let renderedBytes: number | null = null;
  let rawSignals: ReturnType<typeof rawSignalsOf> | null = null;
  const wantsRender = config.renderPolicy === 'always' || (config.renderPolicy === 'heuristic' && shouldRender(obs));
  if (wantsRender && state.renderedSoFar < config.maxRenderPages) {
    const rendered = await renderPage(url, { userAgent: state.userAgent, html: result.body });
    if (rendered.state === 'ok' && rendered.html !== null) {
      const raw = obs;
      obs = parseHtml({ siteHosts: state.hosts, fetch: { ...result, body: rendered.html }, url });
      rawSignals = rawSignalsOf(raw);
      renderMode = 'both';
      domHash = rendered.contentHash;
      renderedBytes = rendered.byteLength;
      state.renderedSoFar++;
      state.counters.rendered++;
    }
  }

  const observationId = await upsertObservation(ctx, scanRunId, {
    url,
    httpStatus: result.status,
    finalUrl: url,
    redirectChain: [],
    contentType: contentType ?? 'text/html',
    contentLength: result.byteLength,
    responseTimeMs: result.elapsedMs,
    canonicalHeader: obs.canonicalHeader,
    xRobotsTag: obs.xRobotsTag,
    cacheControl: result.headers['cache-control'] ?? null,
    title: obs.title,
    metaDescription: obs.metaDescription,
    metaRobots: obs.metaRobots,
    canonicalLink: obs.canonicalLink,
    h1Texts: obs.h1Texts ?? [],
    lang: obs.lang,
    contentHash: obs.contentHash,
    domHash,
    renderMode,
    renderedSizeBytes: renderedBytes,
    wordCount: obs.wordCount,
    images: obs.images,
    schemaErrors: obs.schemaErrors ?? [],
    structuredData: { types: obs.schemaTypes ?? [], productPrice: obs.hasProductPriceSchema, articleDate: obs.hasArticleDateSchema },
    hreflangEntries: obs.hreflangTags,
    rawSignals,
  });
  void observationId;

  // The link graph for this page: replaced as a whole if the page is recorded again.
  const sourceHash = hashUrl(url);
  await db.query(ctx, sql`
    DELETE FROM seo_link_edges
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId} AND source_url_hash = ${sourceHash}
  `);
  const links = obs.outboundLinks;
  for (let i = 0; i < links.length; i += 500) {
    const chunk = links.slice(i, i + 500);
    await db.query(ctx, sql`
      INSERT INTO seo_link_edges
        (id, organization_id, scan_run_id, source_url_hash, target_url, target_url_hash, anchor_text, rel_values, is_internal)
      SELECT gen_random_uuid(), ${ctx.organizationId}, ${scanRunId}, ${sourceHash}, l.url, l.hash, l.anchor,
             CASE WHEN l.rel = '' THEN '{}'::text[] ELSE string_to_array(l.rel, ' ') END, l.internal
      FROM unnest(${chunk.map((l) => l.href)}::text[], ${chunk.map((l) => hashUrl(l.href))}::text[],
                  ${chunk.map((l) => l.anchor)}::text[], ${chunk.map((l) => l.relValues.join(' '))}::text[],
                  ${chunk.map((l) => l.isInternal)}::boolean[]) AS l(url, hash, anchor, rel, internal)
    `);
  }

  await markUrl(ctx, urlStateId, 'fetched', result.status);
  state.counters.fetched++;

  // Queue newly found pages of this website, up to the page limit.
  const known = await knownUrlCount(ctx, scanRunId);
  const room = config.maxPages - known;
  if (room > 0) {
    const candidates = [...new Set(
      links
        .filter((l) => l.isInternal && !l.relValues.includes('nofollow'))
        .map((l) => l.href)
        .filter((href) => inScope(href, state.site.scopePath) && !isExcluded(href, config.exclusionPatterns)),
    )].slice(0, room);
    await queueUrls(ctx, scanRunId, candidates, 'link');
  }
}

interface ObservationWrite {
  url: string;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChain: Array<{ url: string; status: number }>;
  contentType: string | null;
  contentLength: number | null;
  responseTimeMs: number | null;
  canonicalHeader?: string | null;
  xRobotsTag?: string | null;
  cacheControl?: string | null;
  title?: string | null;
  metaDescription?: string | null;
  metaRobots?: string | null;
  canonicalLink?: string | null;
  h1Texts?: string[];
  lang?: string | null;
  contentHash?: string | null;
  domHash?: string | null;
  renderMode?: 'raw' | 'both';
  renderedSizeBytes?: number | null;
  wordCount?: number | null;
  images?: unknown[];
  schemaErrors?: string[];
  structuredData?: unknown;
  hreflangEntries?: unknown[];
  rawSignals?: unknown;
}

/** Writes the whole observation; a second write for the same URL replaces every field. */
async function upsertObservation(ctx: RequestContext, scanRunId: string, o: ObservationWrite): Promise<string> {
  const row = await db.one<{ id: string }>(ctx, sql`
    INSERT INTO seo_page_observations
      (id, organization_id, scan_run_id, url, url_hash, http_status, final_url, redirect_chain,
       content_type, content_length, response_time_ms, canonical_header, x_robots_tag, cache_control,
       title, meta_description, meta_robots, canonical_link, h1_texts, lang, content_hash, dom_hash,
       render_mode, raw_size_bytes, rendered_size_bytes, word_count, images, schema_errors,
       structured_data, hreflang_entries, raw_signals)
    VALUES
      (${randomUUID()}, ${ctx.organizationId}, ${scanRunId}, ${o.url}, ${hashUrl(o.url)}, ${o.httpStatus},
       ${o.finalUrl}, ${JSON.stringify(o.redirectChain)}::jsonb, ${o.contentType}, ${o.contentLength},
       ${o.responseTimeMs}, ${o.canonicalHeader ?? null}, ${o.xRobotsTag ?? null}, ${o.cacheControl ?? null},
       ${o.title ?? null}, ${o.metaDescription ?? null}, ${o.metaRobots ?? null}, ${o.canonicalLink ?? null},
       ${o.h1Texts ?? []}::text[], ${o.lang ?? null}, ${o.contentHash ?? null}, ${o.domHash ?? null},
       ${o.renderMode ?? 'raw'}, ${o.contentLength}, ${o.renderedSizeBytes ?? null}, ${o.wordCount ?? null},
       ${JSON.stringify(o.images ?? [])}::jsonb, ${o.schemaErrors ?? []}::text[],
       ${JSON.stringify(o.structuredData ?? { types: [] })}::jsonb, ${JSON.stringify(o.hreflangEntries ?? [])}::jsonb,
       ${o.rawSignals === undefined || o.rawSignals === null ? null : JSON.stringify(o.rawSignals)}::jsonb)
    ON CONFLICT (scan_run_id, url_hash) DO UPDATE SET
      url = EXCLUDED.url, http_status = EXCLUDED.http_status, final_url = EXCLUDED.final_url,
      redirect_chain = EXCLUDED.redirect_chain, content_type = EXCLUDED.content_type,
      content_length = EXCLUDED.content_length, response_time_ms = EXCLUDED.response_time_ms,
      canonical_header = EXCLUDED.canonical_header, x_robots_tag = EXCLUDED.x_robots_tag,
      cache_control = EXCLUDED.cache_control, title = EXCLUDED.title,
      meta_description = EXCLUDED.meta_description, meta_robots = EXCLUDED.meta_robots,
      canonical_link = EXCLUDED.canonical_link, h1_texts = EXCLUDED.h1_texts, lang = EXCLUDED.lang,
      content_hash = EXCLUDED.content_hash, dom_hash = EXCLUDED.dom_hash, render_mode = EXCLUDED.render_mode,
      raw_size_bytes = EXCLUDED.raw_size_bytes, rendered_size_bytes = EXCLUDED.rendered_size_bytes,
      word_count = EXCLUDED.word_count, images = EXCLUDED.images, schema_errors = EXCLUDED.schema_errors,
      structured_data = EXCLUDED.structured_data, hreflang_entries = EXCLUDED.hreflang_entries,
      raw_signals = EXCLUDED.raw_signals, observed_at = now()
    RETURNING id
  `);
  return row.id;
}

// ─── Evaluate ────────────────────────────────────────────────────────────────

const OBSERVATION_COLUMNS = sql`
  id, url, http_status, final_url, title, meta_description, meta_robots, canonical_link, canonical_header,
  x_robots_tag, lang, h1_texts, content_hash, content_type, content_length, response_time_ms,
  structured_data, hreflang_entries, redirect_chain, word_count, images, schema_errors, render_mode,
  dom_hash, raw_signals`;

type Rating = CwvRating['rating'];
const toRating = (r: string | null): Rating | null =>
  r === 'good' || r === 'needs_improvement' || r === 'poor' ? r : null;

/** Two self-canonical pages with the same visible text are duplicates; a page canonicalized elsewhere is not. */
export function findDuplicates(
  pages: ReadonlyArray<{ url: string; contentHash: string | null; canonicalLink: string | null; evaluable: boolean }>,
): Map<string, string> {
  const groups = new Map<string, typeof pages[number][]>();
  for (const page of pages) {
    if (!page.evaluable || !page.contentHash) continue;
    const list = groups.get(page.contentHash) ?? [];
    list.push(page);
    groups.set(page.contentHash, list);
  }
  const duplicateOf = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const claimsCanonical = group.filter((p) => p.canonicalLink === null || p.canonicalLink === p.url);
    if (claimsCanonical.length < 2) continue;
    const pointedAt = new Map<string, number>();
    for (const p of group) if (p.canonicalLink) pointedAt.set(p.canonicalLink, (pointedAt.get(p.canonicalLink) ?? 0) + 1);
    const preferred = [...claimsCanonical].sort((a, b) =>
      (pointedAt.get(b.url) ?? 0) - (pointedAt.get(a.url) ?? 0) || a.url.length - b.url.length || a.url.localeCompare(b.url),
    )[0]!;
    for (const p of claimsCanonical) if (p.url !== preferred.url) duplicateOf.set(p.url, preferred.url);
  }
  return duplicateOf;
}

interface FindingOutcome {
  id: string;
  inserted: boolean;
  previousStatus: string | null;
  severity: string;
  ruleId: string;
}

async function recordResult(
  tx: Tx,
  ctx: RequestContext,
  args: { siteId: string; scanRunId: string; pageObsId: string | null; result: RuleResult; target: string; clicks: number },
): Promise<FindingOutcome | null> {
  const { result } = args;
  await tx.query(sql`
    INSERT INTO seo_rule_evaluations
      (id, organization_id, scan_run_id, page_obs_id, rule_id, rule_version,
       result, severity, confidence, affected_target, evidence, proposed_fix)
    VALUES
      (${randomUUID()}, ${ctx.organizationId}, ${args.scanRunId}, ${args.pageObsId},
       ${result.ruleId}, ${result.ruleVersion}, ${result.result}, ${result.severity},
       ${result.confidence}, ${args.target}, ${JSON.stringify(result.evidence)}::jsonb, ${result.proposedFix})
  `);
  const signature = signatureFor(result.ruleId, args.target);
  const priorityScore = computePriorityScore(result.severity, result.confidence, args.clicks);
  // A finding someone marked false positive or accepted stays that way. A
  // resolved one, or one waiting for verification, that fires again reopens.
  const upserted = await tx.one<{ id: string; inserted: boolean; previousStatus: string | null }>(sql`
    WITH previous AS (
      SELECT status FROM seo_findings
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${args.siteId} AND signature = ${signature}
    )
    INSERT INTO seo_findings
      (id, site_id, organization_id, rule_id, rule_version, signature, affected_target, status,
       severity, confidence, priority_score, first_seen_run, latest_run, first_seen_at, last_seen_at)
    VALUES
      (${randomUUID()}, ${args.siteId}, ${ctx.organizationId}, ${result.ruleId}, ${result.ruleVersion},
       ${signature}, ${args.target}, 'open', ${result.severity}, ${result.confidence}, ${priorityScore},
       ${args.scanRunId}, ${args.scanRunId}, now(), now())
    ON CONFLICT (site_id, signature) DO UPDATE SET
      latest_run = EXCLUDED.latest_run,
      last_seen_at = now(),
      rule_version = EXCLUDED.rule_version,
      severity = EXCLUDED.severity,
      confidence = EXCLUDED.confidence,
      priority_score = EXCLUDED.priority_score,
      resolved_at = CASE WHEN seo_findings.status IN ('false_positive', 'accepted_exception')
                         THEN seo_findings.resolved_at ELSE NULL END,
      resolution_run = CASE WHEN seo_findings.status IN ('false_positive', 'accepted_exception')
                            THEN seo_findings.resolution_run ELSE NULL END,
      status = CASE WHEN seo_findings.status IN ('verified_resolved', 'ready_for_verification')
                    THEN 'reopened' ELSE seo_findings.status END
    RETURNING id, (xmax = 0) AS inserted, (SELECT status FROM previous) AS previous_status
  `);

  await tx.query(sql`
    INSERT INTO seo_finding_instances (id, finding_id, scan_run_id, organization_id, affected_url, evidence)
    VALUES (${randomUUID()}, ${upserted.id}, ${args.scanRunId}, ${ctx.organizationId}, ${args.target},
            ${JSON.stringify(result.evidence)}::jsonb)
    ON CONFLICT (finding_id, scan_run_id, affected_url) DO UPDATE SET
      evidence = EXCLUDED.evidence, last_seen_at = now()
  `);

  if (result.proposedFix) {
    await tx.query(sql`
      INSERT INTO seo_fix_proposals (id, finding_id, organization_id, target_integration, diff_preview, status, proposed_by)
      SELECT ${randomUUID()}, ${upserted.id}, ${ctx.organizationId}, 'manual', ${result.proposedFix}, 'draft', ${SYSTEM_ID}::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM seo_fix_proposals
        WHERE organization_id = ${ctx.organizationId} AND finding_id = ${upserted.id}
          AND status IN ('draft', 'pending_review')
      )
    `);
  }
  return { ...upserted, severity: result.severity, ruleId: result.ruleId };
}

export async function evaluateScan(ctx: RequestContext, siteId: string, scanRunId: string): Promise<number> {
  await db.query(ctx, sql`
    UPDATE seo_scan_runs SET status = 'evaluating'
    WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
  `);
  // A retried evaluation starts clean.
  await db.query(ctx, sql`
    DELETE FROM seo_rule_evaluations WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);
  const site = await loadSite(ctx, siteId);
  const siteStart = startUrl(site);

  const clickRows = await db.query<{ page: string; totalClicks: number }>(ctx, sql`
    SELECT page, SUM(clicks)::integer AS total_clicks FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND page IS NOT NULL
      AND date >= (current_date - interval '28 days')::date
    GROUP BY page
  `);
  const clicksByUrl = new Map<string, number>();
  for (const row of clickRows) {
    const url = normalizeUrl(row.page);
    if (url) clicksByUrl.set(url, (clicksByUrl.get(url) ?? 0) + row.totalClicks);
  }

  const observations = await db.query<ObservationRow & { rawSignals: unknown }>(ctx, sql`
    SELECT ${OBSERVATION_COLUMNS} FROM seo_page_observations
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);

  const edgeRows = await db.query<{
    sourceUrlHash: string; targetUrl: string; targetUrlHash: string;
    anchorText: string | null; relValues: string[]; isInternal: boolean;
  }>(ctx, sql`
    SELECT source_url_hash, target_url, target_url_hash, anchor_text, rel_values, is_internal
    FROM seo_link_edges WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);
  const urlStates = await db.query<{ url: string; urlHash: string; httpStatus: number | null; discoverySource: string; redirectTarget: string | null }>(ctx, sql`
    SELECT url, url_hash, http_status, discovery_source, redirect_target FROM seo_scan_url_states
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);
  const statusByUrlHash = new Map<string, number | null>();
  const seedUrlHashes = new Set<string>();
  for (const u of urlStates) {
    statusByUrlHash.set(u.urlHash, u.httpStatus);
    if (u.discoverySource === 'seed') {
      seedUrlHashes.add(u.urlHash);
      // The page a start address redirects to is the real start page.
      if (u.redirectTarget && isRelatedHost(site.normalizedHost, urlHostKey(u.redirectTarget) ?? '')) {
        seedUrlHashes.add(hashUrl(u.redirectTarget));
      }
    }
  }

  const outboundBySourceHash = new Map<string, Array<{ href: string; anchor: string | null; isInternal: boolean; relValues: string[]; statusCode: number | null }>>();
  const inboundInternalCountByTargetHash = new Map<string, number>();
  for (const e of edgeRows) {
    const list = outboundBySourceHash.get(e.sourceUrlHash) ?? [];
    list.push({
      href: e.targetUrl, anchor: e.anchorText, isInternal: e.isInternal, relValues: e.relValues,
      statusCode: statusByUrlHash.get(e.targetUrlHash) ?? null,
    });
    outboundBySourceHash.set(e.sourceUrlHash, list);
    if (e.isInternal && e.sourceUrlHash !== e.targetUrlHash) {
      inboundInternalCountByTargetHash.set(e.targetUrlHash, (inboundInternalCountByTargetHash.get(e.targetUrlHash) ?? 0) + 1);
    }
  }

  const lhRows = await db.query<{ url: string; perfScore: number | null }>(ctx, sql`
    SELECT DISTINCT ON (url) url, perf_score FROM seo_cwv_observations
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND url IS NOT NULL
      AND data_source = 'lighthouse_lab' AND observed_at >= now() - interval '14 days'
    ORDER BY url, observed_at DESC
  `);
  const lhScoreByUrl = new Map<string, number>();
  for (const r of lhRows) {
    const url = normalizeUrl(r.url);
    if (url && r.perfScore != null) lhScoreByUrl.set(url, r.perfScore);
  }

  const sitemapRows = await db.query<{ url: string; lastmod: Date | null }>(ctx, sql`
    SELECT url, lastmod FROM seo_sitemap_entries
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);
  const sitemapByUrl = new Map<string, { lastmod: Date | null }>();
  for (const row of sitemapRows) sitemapByUrl.set(normalizeUrl(row.url) ?? row.url, { lastmod: row.lastmod });

  type Tag = { hreflang: string; href: string };
  const hreflangByUrl = new Map<string, Tag[]>();
  for (const o of observations) {
    const tags = Array.isArray(o.hreflangEntries) ? (o.hreflangEntries as Tag[]) : [];
    if (tags.length > 0) hreflangByUrl.set(o.url, tags);
  }
  const hreflangMissingByUrl = new Map<string, string[]>();
  for (const [sourceUrl, sourceTags] of hreflangByUrl) {
    const missing: string[] = [];
    for (const tag of sourceTags) {
      if (tag.hreflang.toLowerCase() === 'x-default') continue;
      const target = normalizeUrl(tag.href) ?? tag.href;
      if (target === sourceUrl) continue;
      const siblingTags = hreflangByUrl.get(target);
      if (!siblingTags) continue; // only verifiable when the sibling was crawled
      if (!siblingTags.some((t) => (normalizeUrl(t.href) ?? t.href) === sourceUrl)) missing.push(tag.hreflang);
    }
    if (missing.length > 0) hreflangMissingByUrl.set(sourceUrl, missing);
  }

  const duplicateOfByUrl = findDuplicates(observations.map((o) => ({
    url: o.url,
    contentHash: o.contentHash,
    canonicalLink: o.canonicalLink,
    evaluable: isEvaluablePage(o),
  })));

  const enabledRows = await db.query<{ ruleId: string }>(ctx, sql`
    SELECT rule_id FROM registry_seo_rule WHERE organization_id = ${ctx.organizationId} AND active = true AND tested = true
  `);
  const enabled = new Set(enabledRows.map((rule) => rule.ruleId));

  // Chrome field data covers the whole website. It is judged once, and only
  // when a CrUX fetch actually answered (data or "not enough data").
  const crux = await db.maybeOne<{
    lcpP75: number | null; lcpRating: string | null; inpP75: number | null; inpRating: string | null;
    clsP75: string | null; clsRating: string | null;
  }>(ctx, sql`
    SELECT lcp_p75, lcp_rating, inp_p75, inp_rating, cls_p75, cls_rating FROM seo_cwv_observations
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND url IS NULL
      AND observed_at >= now() - interval '35 days'
    ORDER BY observed_at DESC LIMIT 1
  `);
  const cruxState = await db.maybeOne<{ state: string }>(ctx, sql`
    SELECT state FROM seo_performance_status
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = 'crux'
  `);
  const originCruxLcp = crux?.lcpP75 != null && toRating(crux.lcpRating) ? { p75: crux.lcpP75, rating: toRating(crux.lcpRating)! } : null;
  const originCruxInp = crux?.inpP75 != null && toRating(crux.inpRating) ? { p75: crux.inpP75, rating: toRating(crux.inpRating)! } : null;
  const originCruxCls = crux?.clsP75 != null && toRating(crux.clsRating) ? { p75: Number.parseFloat(crux.clsP75), rating: toRating(crux.clsRating)! } : null;
  const siteRulesEvaluated = Boolean(originCruxLcp || originCruxInp || originCruxCls) || cruxState?.state === 'no_data';

  const maps: HydrationMaps = {
    outboundBySourceHash, inboundInternalCountByTargetHash, sitemapByUrl, hreflangMissingByUrl,
    duplicateOfByUrl, clicksByUrl, lhScoreByUrl, seedUrlHashes,
    originCruxLcp: null, originCruxInp: null, originCruxCls: null,
    nowMs: Date.now(),
  };

  const outcomes: FindingOutcome[] = [];
  let pagesEvaluated = 0;
  for (const row of observations) {
    const observation = hydrateObservation(row, maps);
    if (isEvaluablePage(observation)) pagesEvaluated++;
    const results = evaluateAll(observation)
      .filter((r) => enabled.has(r.ruleId) && (r.result === 'fail' || r.result === 'review'));
    if (results.length === 0) continue;
    await db.transaction(ctx, async (tx) => {
      for (const result of results) {
        const target = result.affectedTarget ?? row.url;
        const outcome = await recordResult(tx, ctx, {
          siteId, scanRunId, pageObsId: row.id, result, target, clicks: clicksByUrl.get(target) ?? 0,
        });
        if (outcome) outcomes.push(outcome);
      }
    });
  }

  if (siteRulesEvaluated) {
    const siteObservation: PageObservation = {
      ...hydrateObservation(emptyObservationRow(siteStart), { ...maps, outboundBySourceHash: new Map() }),
      isPriority: true,
      cruxLcp: originCruxLcp, cruxInp: originCruxInp, cruxCls: originCruxCls,
    };
    const results = evaluateSiteRules(siteObservation)
      .filter((r) => enabled.has(r.ruleId) && (r.result === 'fail' || r.result === 'review'));
    if (results.length > 0) {
      await db.transaction(ctx, async (tx) => {
        for (const result of results) {
          const outcome = await recordResult(tx, ctx, {
            siteId, scanRunId, pageObsId: null,
            result: { ...result, evidence: { ...result.evidence, scope: 'origin' } },
            target: siteStart, clicks: 0,
          });
          if (outcome) outcomes.push(outcome);
        }
      });
    }
  }

  const run = await db.one<{ fetchedCount: number; failedCount: number; skippedCount: number; discoveredCount: number; maxPages: number }>(ctx, sql`
    SELECT r.fetched_count, r.failed_count, r.skipped_count, r.discovered_count, c.max_pages
    FROM seo_scan_runs r JOIN seo_scan_configs c ON c.id = r.config_id AND c.organization_id = r.organization_id
    WHERE r.organization_id = ${ctx.organizationId} AND r.id = ${scanRunId}
  `);
  const hitPageLimit = run.discoveredCount >= run.maxPages;
  const complete = pagesEvaluated > 0 && run.failedCount === 0 && run.skippedCount === 0 && !hitPageLimit;

  const observedTargets = new Set<string>();
  for (const o of observations) {
    observedTargets.add(o.url);
    // Checkups before the URL fix stored the start page without its trailing slash.
    if (o.url.endsWith('/') && new URL(o.url).pathname === '/') observedTargets.add(o.url.slice(0, -1));
  }
  const resolved = pagesEvaluated === 0 ? 0 : await resolveFixedFindings(ctx, {
    siteId, scanRunId, complete, enabled, siteRulesEvaluated, siteStart, observedTargets: [...observedTargets],
  });
  await raiseAlerts(ctx, siteId, scanRunId, outcomes);

  const offSite = urlStates.find((u) => u.discoverySource === 'seed' && u.redirectTarget
    && !isRelatedHost(site.normalizedHost, urlHostKey(u.redirectTarget) ?? ''));
  const termination = pagesEvaluated === 0
    ? offSite
      ? `Your website address redirects to ${urlHostKey(offSite.redirectTarget!) ?? 'another website'}. Add that address as a website to check it.`
      : 'No pages could be audited. Check website access and robots.txt.'
    : hitPageLimit
      ? 'The configured page limit was reached.'
      : run.failedCount + run.skippedCount > 0
        ? 'Some pages could not be checked. See the checkup details.'
        : null;
  const openFindings = await db.one<{ n: number }>(ctx, sql`
    SELECT count(DISTINCT finding_id)::integer AS n FROM seo_finding_instances
    WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ${scanRunId}
  `);
  await db.query(ctx, sql`
    UPDATE seo_scan_runs
    SET status = ${pagesEvaluated === 0 ? 'failed' : complete ? 'completed' : 'completed_partial'},
        termination_reason = ${termination},
        coverage_pct = ${run.discoveredCount > 0 ? Math.min(100, Math.round((run.fetchedCount / run.discoveredCount) * 10000) / 100) : null},
        ended_at = now(),
        findings_count = ${openFindings.n},
        notes = ${resolved > 0 ? `${resolved} issue(s) no longer found and marked resolved.` : null}
    WHERE organization_id = ${ctx.organizationId} AND id = ${scanRunId}
  `);

  await pruneOldScanData(ctx, siteId);
  return observations.length;
}

function emptyObservationRow(url: string): ObservationRow {
  return {
    id: '', url, httpStatus: 200, finalUrl: url, title: null, metaDescription: null, metaRobots: null,
    canonicalLink: null, canonicalHeader: null, xRobotsTag: null, lang: null, h1Texts: [], contentHash: null,
    contentType: 'text/html', contentLength: null, responseTimeMs: null, structuredData: { types: [] },
    hreflangEntries: [], redirectChain: [], wordCount: null, images: [], schemaErrors: [], renderMode: 'raw',
    domHash: null,
  };
}

/**
 * A finding the checkup no longer sees is resolved — when the checkup could
 * have seen it: the page was checked this time (or the whole site was), and
 * the rule ran. False positives and accepted exceptions are left as they are.
 */
async function resolveFixedFindings(
  ctx: RequestContext,
  args: {
    siteId: string; scanRunId: string; complete: boolean; enabled: ReadonlySet<string>;
    siteRulesEvaluated: boolean; siteStart: string; observedTargets: string[];
  },
): Promise<number> {
  const rules = getActiveRules().filter((rule) => args.enabled.has(rule.ruleId));
  const pageRules = rules.filter((rule) => (rule.scope ?? 'page') === 'page').map((rule) => rule.ruleId);
  const allSiteRules = getActiveRules().filter((rule) => rule.scope === 'site').map((rule) => rule.ruleId);
  const siteRules = args.siteRulesEvaluated ? allSiteRules.filter((id) => args.enabled.has(id)) : [];
  const rows = await db.query<{ id: string }>(ctx, sql`
    UPDATE seo_findings f
    SET status = 'verified_resolved', resolved_at = now(), resolution_run = ${args.scanRunId}
    WHERE f.organization_id = ${ctx.organizationId} AND f.site_id = ${args.siteId}
      AND f.status = ANY(${[...UNRESOLVED]}::text[])
      AND f.latest_run <> ${args.scanRunId}
      AND (
        (f.rule_id = ANY(${pageRules}::text[])
          AND (${args.complete}::boolean OR f.affected_target = ANY(${args.observedTargets}::text[])))
        OR f.rule_id = ANY(${siteRules}::text[])
        -- Field-data findings used to be raised once per page; they now describe the whole site.
        OR (f.rule_id = ANY(${allSiteRules}::text[]) AND f.affected_target <> ${args.siteStart})
      )
    RETURNING f.id
  `);
  return rows.length;
}

/** One notification per checkup for new urgent/high issues, one for issues that came back. */
async function raiseAlerts(ctx: RequestContext, siteId: string, scanRunId: string, outcomes: FindingOutcome[]): Promise<void> {
  const fresh = new Map<string, FindingOutcome>();
  const back = new Map<string, FindingOutcome>();
  for (const o of outcomes) {
    if (o.inserted && (o.severity === 'critical' || o.severity === 'high')) fresh.set(o.id, o);
    if (!o.inserted && (o.previousStatus === 'verified_resolved' || o.previousStatus === 'ready_for_verification')) back.set(o.id, o);
  }
  const titles = (list: FindingOutcome[]) =>
    [...new Set(list.map((o) => getSeoRuleCopy(o.ruleId).title))].slice(0, 3).join('; ');
  if (fresh.size > 0) {
    const list = [...fresh.values()];
    const critical = list.filter((o) => o.severity === 'critical').length;
    const message = critical > 0
      ? `This checkup found ${critical} new urgent and ${list.length - critical} new high-priority issue${list.length === 1 ? '' : 's'}. ${titles(list)}`
      : `This checkup found ${list.length} new high-priority issue${list.length === 1 ? '' : 's'}. ${titles(list)}`;
    await db.query(ctx, sql`
      INSERT INTO seo_alerts (id, site_id, organization_id, trigger_type, dedup_key, severity, message, metadata)
      VALUES (${randomUUID()}, ${siteId}, ${ctx.organizationId},
              ${critical > 0 ? 'Critical issue detected' : 'High-priority issue detected'},
              ${`scan:${scanRunId}:new`}, ${critical > 0 ? 'critical' : 'high'}, ${message},
              ${JSON.stringify({ scanRunId, count: list.length, critical, findingIds: list.slice(0, 50).map((o) => o.id) })}::jsonb)
      ON CONFLICT (site_id, dedup_key) DO NOTHING
    `);
  }
  if (back.size > 0) {
    const list = [...back.values()];
    const order = ['critical', 'high', 'moderate', 'low'];
    const severity = order.find((s) => list.some((o) => o.severity === s)) ?? 'low';
    await db.query(ctx, sql`
      INSERT INTO seo_alerts (id, site_id, organization_id, trigger_type, dedup_key, severity, message, metadata)
      VALUES (${randomUUID()}, ${siteId}, ${ctx.organizationId}, 'Issue reopened', ${`scan:${scanRunId}:reopened`},
              ${severity},
              ${`${list.length} issue${list.length === 1 ? '' : 's'} came back after being marked fixed. ${titles(list)}`},
              ${JSON.stringify({ scanRunId, count: list.length, findingIds: list.slice(0, 50).map((o) => o.id) })}::jsonb)
      ON CONFLICT (site_id, dedup_key) DO NOTHING
    `);
  }
}

/**
 * Raw page data is only needed for recent checkups: findings, their per-scan
 * instances and the checkup history are kept; observations, link graphs,
 * sitemap copies and rule evaluations of older checkups are removed.
 */
export async function pruneOldScanData(ctx: RequestContext, siteId: string, keep = RAW_SCANS_KEPT): Promise<void> {
  const old = await db.query<{ id: string }>(ctx, sql`
    SELECT id FROM seo_scan_runs
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
      AND status IN ('completed', 'completed_partial', 'failed', 'cancelled')
    ORDER BY queued_at DESC OFFSET ${keep}
  `);
  if (old.length === 0) return;
  const ids = old.map((row) => row.id);
  await db.query(ctx, sql`DELETE FROM seo_rule_evaluations WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ANY(${ids}::uuid[])`);
  await db.query(ctx, sql`DELETE FROM seo_link_edges WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ANY(${ids}::uuid[])`);
  await db.query(ctx, sql`DELETE FROM seo_sitemap_entries WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ANY(${ids}::uuid[])`);
  await db.query(ctx, sql`DELETE FROM seo_page_observations WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ANY(${ids}::uuid[])`);
  await db.query(ctx, sql`DELETE FROM seo_scan_url_states WHERE organization_id = ${ctx.organizationId} AND scan_run_id = ANY(${ids}::uuid[])`);
}
