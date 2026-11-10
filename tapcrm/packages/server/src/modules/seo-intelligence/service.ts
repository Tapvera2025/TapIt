import { randomUUID } from 'node:crypto';
import type { SeoFindingsTrendPoint } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  listSites, getSite, createSite, updateSite,
  listScanRuns, getScanRun, createScanRun,
  listFindings, getFinding,
  listGscMetrics,
} from './repository.js';
import { importGscPerformance } from './gsc-sync.js';
import { ApplicationError } from '../../errors.js';
import { SearchConsoleConfigurationError, SearchConsoleUnavailableError } from '../../platform/integrations/google/search-console.js';
import { SeoSiteValidationError } from './errors.js';
import { crawlDiscoverHandle, serpObserveHandle, cruxFetchHandle, lighthouseAuditHandle } from './jobs.js';
import { getRankTrackingStatus, RANK_BATCH_LIMIT } from './rank-tracking.js';
import { ensureScanConfig, getScanConfig, updateScanConfig, SCAN_LIMITS, type ScanConfig } from './scan-config.js';
import { getSiteAllowances, setSiteAllowances } from './provider-allowance.js';
import { renderingAvailable } from './crawler/render.js';
import { getPerformanceStatus, setPerformanceStatus } from './performance.js';
import { provisionSeoRules } from './provisioning.js';

function normalizeHost(rawUrl: string): string {
  const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
  return u.hostname.replace(/^www\./, '');
}

// ─── Sites ────────────────────────────────────────────────────────────────────

export async function getSiteList(ctx: RequestContext) {
  return listSites(ctx);
}

export async function getSiteDetail(ctx: RequestContext, siteId: string) {
  return getSite(ctx, siteId);
}

export async function registerSite(
  ctx: RequestContext,
  input: {
    clientId: string | null;
    displayUrl: string;
    timezone: string;
    locale: string;
    businessIntents: string[];
    stackNotes: string | null;
  },
) {
  if (input.clientId !== null) {
    const client = await db.maybeOne(ctx, sql`
      SELECT id FROM client WHERE organization_id = ${ctx.organizationId}
        AND id = ${input.clientId} AND status = 'active'
    `);
    if (!client) throw new SeoSiteValidationError('Select an active client in this organization, or leave the client empty.');
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.displayUrl.startsWith('http') ? input.displayUrl : `https://${input.displayUrl}`);
  } catch {
    throw new SeoSiteValidationError('Invalid site URL');
  }

  const existing = await db.maybeOne(ctx, sql`
    SELECT id FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND normalized_host = ${parsedUrl.hostname.replace(/^www\./, '')} AND active = true
  `);
  if (existing) throw new SeoSiteValidationError('A site with this domain is already registered');

  return createSite(ctx, {
    id: randomUUID(),
    clientId: input.clientId,
    displayUrl: parsedUrl.origin,
    normalizedHost: normalizeHost(input.displayUrl),
    scopePath: parsedUrl.pathname === '/' ? '' : parsedUrl.pathname,
    canonicalScheme: parsedUrl.protocol.replace(':', ''),
    timezone: input.timezone,
    locale: input.locale,
    businessIntents: input.businessIntents,
    stackNotes: input.stackNotes,
  });
}

export async function patchSite(
  ctx: RequestContext,
  siteId: string,
  patch: Parameters<typeof updateSite>[2],
) {
  return updateSite(ctx, siteId, patch);
}

// ─── Scans ────────────────────────────────────────────────────────────────────

export async function getScanList(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  return listScanRuns(ctx, siteId);
}

export async function getScanDetail(ctx: RequestContext, scanRunId: string) {
  return getScanRun(ctx, scanRunId);
}

export async function triggerScan(
  ctx: RequestContext,
  siteId: string,
  triggeredBy: string,
): Promise<{ scanRunId: string }> {
  const site = await getSite(ctx, siteId);
  const result = await db.transaction(ctx, async (tx) => {
    await tx.one(sql`SELECT id FROM seo_sites WHERE organization_id = ${ctx.organizationId} AND id = ${site.id} FOR UPDATE`);
    const active = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM seo_scan_runs WHERE organization_id = ${ctx.organizationId} AND site_id = ${site.id}
        AND status IN ('queued', 'discovering', 'fetching', 'rendering', 'evaluating', 'aggregating')
      ORDER BY queued_at DESC LIMIT 1
    `);
    if (active) return { scanRunId: active.id, reused: true };
    // Manual and scheduled checkups share one set of per-site settings.
    const configId = (await ensureScanConfig(tx, ctx.organizationId, site.id)).id;
    const scanRunId = randomUUID();
    await createScanRun(tx, { id: scanRunId, organizationId: ctx.organizationId, siteId: site.id,
      configId, ruleReleaseId: 'v1', triggeredBy });
    return { scanRunId, reused: false };
  });
  if (!result.reused) {
    try {
      await crawlDiscoverHandle.enqueue({ organizationId: ctx.organizationId,
        key: `seo:discover:${result.scanRunId}`,
        payload: { organizationId: ctx.organizationId, siteId: site.id, scanRunId: result.scanRunId } });
    } catch {
      await db.query(ctx, sql`UPDATE seo_scan_runs SET status = 'failed', ended_at = now(),
        termination_reason = 'The scan could not be queued. Please retry.'
        WHERE organization_id = ${ctx.organizationId} AND id = ${result.scanRunId}`);
      throw new ApplicationError('The scan could not be queued. Please retry.', 503, 'SEO_SCAN_QUEUE_UNAVAILABLE');
    }
  }
  return { scanRunId: result.scanRunId };
}

// ─── Findings ─────────────────────────────────────────────────────────────────

function canonicalFindingStatus(status: string): string {
  const aliases: Record<string, string> = {
    dismissed: 'false_positive',
    resolved: 'verified_resolved',
    fixed_unverified: 'ready_for_verification',
  };
  return aliases[status] ?? status;
}

export async function getFindings(
  ctx: RequestContext,
  siteId: string,
  opts: { status?: string | undefined; severity?: string | undefined; limit?: number | undefined; offset?: number | undefined },
) {
  await getSite(ctx, siteId);
  return listFindings(ctx, siteId, {
    ...opts,
    status: opts.status ? canonicalFindingStatus(opts.status) : undefined,
  });
}

export async function getFindingDetail(ctx: RequestContext, findingId: string) {
  return getFinding(ctx, findingId);
}

/**
 * Estimated open findings at the end of each UTC day (today: as of now),
 * reconstructed from first-seen and latest resolution timestamps. Older
 * close/reopen cycles and severity changes are not stored as historical events.
 * Every UTC calendar day and severity is returned, including zero counts.
 */
export async function getFindingsTrend(ctx: RequestContext, siteId: string, days = 30): Promise<SeoFindingsTrendPoint[]> {
  await getSite(ctx, siteId);
  const clampedDays = Number.isFinite(days) ? Math.max(1, Math.min(180, Math.round(days))) : 30;
  return db.query<SeoFindingsTrendPoint>(ctx, sql`
    WITH day_series AS (
      SELECT generate_series(
        ((now() AT TIME ZONE 'UTC')::date - ${clampedDays - 1}::integer)::timestamp,
        (now() AT TIME ZONE 'UTC')::date::timestamp,
        interval '1 day'
      )::date AS day
    ),
    sev_series AS (
      SELECT unnest(ARRAY['critical','high','moderate','low','informational']::text[]) AS severity
    )
    SELECT to_char(ds.day, 'YYYY-MM-DD') AS day,
           ss.severity,
           COUNT(f.id)::int AS "openCount"
    FROM day_series ds
    CROSS JOIN sev_series ss
    LEFT JOIN seo_findings f
      ON f.organization_id = ${ctx.organizationId}
     AND f.site_id = ${siteId}
     AND f.severity = ss.severity
     AND f.first_seen_at < LEAST((ds.day + 1)::timestamp AT TIME ZONE 'UTC', now())
     AND (f.resolved_at IS NULL OR f.resolved_at >= LEAST((ds.day + 1)::timestamp AT TIME ZONE 'UTC', now()))
    GROUP BY ds.day, ss.severity
    ORDER BY ds.day, ss.severity
  `);
}

/**
 * Collapses open findings by (ruleId, severity) so a template bug that fires
 * on 50 pages shows as one group instead of drowning the Audit panel. Each
 * group carries up to 5 sample affected URLs (highest priority first) and the
 * total count so the UI can offer an "expand to all N" affordance.
 */
export async function getFindingGroups(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  return db.query(ctx, sql`
    SELECT rule_id              AS "ruleId",
           severity,
           COUNT(*)::int        AS "count",
           MAX(priority_score)::float AS "maxPriority",
           MIN(first_seen_at)   AS "firstSeenAt",
           (array_agg(affected_target ORDER BY priority_score DESC NULLS LAST, first_seen_at DESC))[1:5] AS "sampleTargets",
           (array_agg(id ORDER BY priority_score DESC NULLS LAST, first_seen_at DESC))[1:5] AS "sampleIds"
    FROM seo_findings
    WHERE organization_id = ${ctx.organizationId}
      AND site_id = ${siteId}
      AND status IN ('open', 'assigned', 'in_progress', 'reopened')
    GROUP BY rule_id, severity
    ORDER BY MAX(priority_score) DESC NULLS LAST, COUNT(*) DESC
  `);
}

export async function updateFindingStatus(
  ctx: RequestContext,
  findingId: string,
  patch: { status?: string | undefined; assignedTo?: string | null | undefined },
) {
  const finding = await getFinding(ctx, findingId);
  const clauses = [];
  if (patch.status) {
    const status = canonicalFindingStatus(patch.status);
    clauses.push(sql`status = ${status}`);
    if (['verified_resolved', 'accepted_exception', 'false_positive'].includes(status)) {
      clauses.push(sql`resolved_at = COALESCE(resolved_at, now())`);
    } else {
      clauses.push(sql`resolved_at = NULL`, sql`resolution_run = NULL`);
    }
  }
  if (patch.assignedTo !== undefined) clauses.push(sql`assigned_to = ${patch.assignedTo}`);
  if (clauses.length === 0) return finding;

  return db.one(ctx, sql`
    UPDATE seo_findings SET ${sql.join(clauses)}
    WHERE organization_id = ${ctx.organizationId} AND id = ${findingId}
    RETURNING *
  `);
}

// ─── Keywords ─────────────────────────────────────────────────────────────────

export async function getKeywords(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  return db.query(ctx, sql`
    SELECT * FROM seo_keywords
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
    ORDER BY tracked DESC, search_volume DESC NULLS LAST, keyword ASC
    LIMIT 500
  `);
}

/** Track or stop tracking a search term's Google position. */
export async function setKeywordTracked(ctx: RequestContext, siteId: string, keywordId: string, tracked: boolean) {
  await getSite(ctx, siteId);
  const row = await db.maybeOne(ctx, sql`
    UPDATE seo_keywords SET tracked = ${tracked}
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND id = ${keywordId}
    RETURNING *
  `);
  if (!row) throw new ApplicationError('Search term not found.', 404, 'SEO_KEYWORD_NOT_FOUND');
  return row;
}

// ─── Site settings ────────────────────────────────────────────────────────────

export interface SiteSettings {
  crawl: Omit<ScanConfig, 'id' | 'maxBytesPerPage'>;
  renderingAvailable: boolean;
  limits: typeof SCAN_LIMITS;
  allowances: Awaited<ReturnType<typeof getSiteAllowances>>;
}

function settingsView(config: ScanConfig, allowances: SiteSettings['allowances']): SiteSettings {
  const { id: _id, maxBytesPerPage: _bytes, ...crawl } = config;
  return { crawl, renderingAvailable: renderingAvailable(), limits: SCAN_LIMITS, allowances };
}

export async function getSiteSettings(ctx: RequestContext, siteId: string): Promise<SiteSettings> {
  await getSite(ctx, siteId);
  return settingsView(await getScanConfig(ctx, siteId), await getSiteAllowances(ctx, siteId));
}

export async function patchSiteSettings(
  ctx: RequestContext,
  siteId: string,
  patch: {
    crawl?: { [K in keyof Omit<ScanConfig, 'id' | 'maxBytesPerPage'>]?: ScanConfig[K] | undefined } | undefined;
    allowances?: { serpSearches?: number | undefined; perplexity?: number | undefined; moz?: number | undefined } | undefined;
  },
): Promise<SiteSettings> {
  await getSite(ctx, siteId);
  const crawl = Object.fromEntries(Object.entries(patch.crawl ?? {}).filter(([, v]) => v !== undefined));
  if (crawl['renderPolicy'] !== undefined && crawl['renderPolicy'] !== 'never' && !renderingAvailable()) {
    throw new SeoSiteValidationError('JavaScript rendering is not available on this server.');
  }
  const config = await updateScanConfig(ctx, siteId, crawl);
  const allowancePatch = Object.fromEntries(Object.entries(patch.allowances ?? {}).filter(([, v]) => v !== undefined));
  const allowances = Object.keys(allowancePatch).length > 0
    ? await setSiteAllowances(ctx, siteId, allowancePatch)
    : await getSiteAllowances(ctx, siteId);
  return settingsView(config, allowances);
}

// ─── SERP Observations ────────────────────────────────────────────────────────

export async function getRankStatus(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  return getRankTrackingStatus(ctx, siteId);
}

export async function queueRankCheck(ctx: RequestContext, siteId: string) {
  const status = await getRankStatus(ctx, siteId);
  if (!status.configured) throw new ApplicationError('SerpApi credentials are not configured on the server.', 422, 'SEO_SERP_CONFIGURATION');
  if (status.remaining === 0) throw new ApplicationError('The monthly SERP search allowance is exhausted or disabled.', 429, 'SEO_SERP_LIMIT');
  await serpObserveHandle.enqueue({ organizationId: ctx.organizationId,
    key: `rank-${siteId}-${Math.floor(Date.now() / 60000)}`,
    payload: { organizationId: ctx.organizationId, siteId } });
  return { state: 'queued', batchLimit: RANK_BATCH_LIMIT };
}

export async function getSerpObservations(
  ctx: RequestContext,
  siteId: string,
  opts: { limit?: number } = {},
) {
  await getSite(ctx, siteId);
  const limit = opts.limit ?? 200;
  return db.query(ctx, sql`
    SELECT o.*, k.keyword AS query
    FROM seo_serp_observations o
    JOIN seo_keywords k ON k.id = o.keyword_id
    WHERE o.organization_id = ${ctx.organizationId} AND o.site_id = ${siteId}
    ORDER BY o.observed_at DESC
    LIMIT ${limit}
  `);
}

// ─── AI Observations ──────────────────────────────────────────────────────────

export async function getAiObservations(
  ctx: RequestContext,
  siteId: string,
  opts: { limit?: number } = {},
) {
  await getSite(ctx, siteId);
  const limit = opts.limit ?? 100;
  return db.query(ctx, sql`
    SELECT o.*, p.prompt_text
    FROM seo_ai_observations o
    JOIN seo_ai_prompts p ON p.id = o.prompt_id
    WHERE o.organization_id = ${ctx.organizationId} AND o.site_id = ${siteId}
    ORDER BY o.observed_at DESC
    LIMIT ${limit}
  `);
}

// ─── Backlinks ────────────────────────────────────────────────────────────────

export async function getBacklinks(
  ctx: RequestContext,
  siteId: string,
  opts: { limit?: number } = {},
) {
  await getSite(ctx, siteId);
  const limit = opts.limit ?? 200;
  return db.query(ctx, sql`
    SELECT * FROM seo_backlinks
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
    ORDER BY domain_rating DESC NULLS LAST, last_seen_at DESC
    LIMIT ${limit}
  `);
}

// ─── CWV Observations ─────────────────────────────────────────────────────────

export async function getCwvObservations(
  ctx: RequestContext,
  siteId: string,
  opts: { limit?: number } = {},
) {
  await getSite(ctx, siteId);
  const limit = opts.limit ?? 50;
  return db.query(ctx, sql`
    SELECT *, cls_p75::float AS cls_p75, lab_cls::float AS lab_cls FROM seo_cwv_observations
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
    ORDER BY observed_at DESC
    LIMIT ${limit}
  `);
}

export async function getSitePerformanceStatus(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  return getPerformanceStatus(ctx, siteId);
}

export async function queuePerformanceRefresh(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  const payload = { organizationId: ctx.organizationId, siteId, extra: { homepageOnly: true } };
  const suffix = `${siteId}-${randomUUID()}`;
  try {
    await setPerformanceStatus(ctx, siteId, 'crux', 'running', 'Refresh queued. Waiting for a background worker.');
    await setPerformanceStatus(ctx, siteId, 'pagespeed', 'running', 'Refresh queued. Waiting for a background worker.');
    await cruxFetchHandle.enqueue({ organizationId: ctx.organizationId, key: `crux-refresh-${suffix}`, payload });
    await lighthouseAuditHandle.enqueue({ organizationId: ctx.organizationId, key: `lab-refresh-${suffix}`, payload });
  } catch {
    await setPerformanceStatus(ctx, siteId, 'crux', 'error', 'The refresh could not be queued. Please retry.');
    await setPerformanceStatus(ctx, siteId, 'pagespeed', 'error', 'The refresh could not be queued. Please retry.');
    throw new ApplicationError('The performance refresh could not be queued. Please retry.', 503, 'SEO_PERFORMANCE_QUEUE');
  }
  return { state: 'queued' };
}

// ─── Fix Proposals ────────────────────────────────────────────────────────────

export async function getFixProposals(
  ctx: RequestContext,
  siteId: string,
  opts: { status?: string | undefined } = {},
) {
  await getSite(ctx, siteId);
  const statusFilter = opts.status ? sql` AND fp.status = ${opts.status}` : sql``;
  return db.query(ctx, sql`
    SELECT fp.id,
           fp.finding_id            AS "findingId",
           f.rule_id                AS "ruleId",
           f.severity,
           f.affected_target        AS "affectedTarget",
           fp.diff_preview          AS "proposedFix",
           fp.status,
           fp.created_at            AS "createdAt",
           fp.updated_at            AS "updatedAt"
    FROM seo_fix_proposals fp
    JOIN seo_findings f ON f.id = fp.finding_id
    WHERE f.organization_id = ${ctx.organizationId}
      AND f.site_id = ${siteId}
    ${statusFilter}
    ORDER BY fp.created_at DESC
    LIMIT 200
  `);
}

export async function patchFixProposal(
  ctx: RequestContext,
  proposalId: string,
  patch: { status: 'executed' | 'rejected' },
) {
  const row = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT fp.id FROM seo_fix_proposals fp
    JOIN seo_findings f ON f.id = fp.finding_id
    WHERE f.organization_id = ${ctx.organizationId} AND fp.id = ${proposalId}
  `);
  if (!row) throw new Error(`Fix proposal not found: ${proposalId}`);
  return db.one(ctx, sql`
    UPDATE seo_fix_proposals SET status = ${patch.status}, updated_at = now()
    WHERE id = ${proposalId}
    RETURNING id, finding_id AS "findingId", diff_preview AS "proposedFix",
              status, created_at AS "createdAt", updated_at AS "updatedAt"
  `);
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export async function getAlerts(ctx: RequestContext, siteId: string) {
  await getSite(ctx, siteId);
  return db.query(ctx, sql`
    SELECT id,
           site_id             AS "siteId",
           trigger_type        AS title,
           message             AS body,
           severity,
           created_at          AS "createdAt",
           acknowledged_at     AS "acknowledgedAt"
    FROM seo_alerts
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
    ORDER BY created_at DESC
    LIMIT 200
  `);
}

export async function acknowledgeAlert(
  ctx: RequestContext,
  alertId: string,
  actorId: string,
) {
  return db.one(ctx, sql`
    UPDATE seo_alerts
    SET acknowledged_at = now(), acknowledged_by = ${actorId}
    WHERE organization_id = ${ctx.organizationId} AND id = ${alertId}
    RETURNING id,
              site_id         AS "siteId",
              trigger_type    AS title,
              message         AS body,
              severity,
              created_at      AS "createdAt",
              acknowledged_at AS "acknowledgedAt"
  `);
}

// ─── Rules ────────────────────────────────────────────────────────────────────

export async function getRules(ctx: RequestContext) {
  const query = sql`
    SELECT rule_id     AS "ruleId",
           rule_group  AS "group",
           severity,
           active,
           tested,
           description
    FROM registry_seo_rule
    WHERE organization_id = ${ctx.organizationId}
    ORDER BY rule_group, rule_id
  `;
  const rows = await db.query(ctx, query);
  if (rows.length > 0) return rows;

  // Self-heal: tenant was provisioned before the registry was wired, or an older
  // migration left the table empty. Seed once and re-read.
  await db.transaction(ctx, async (tx) => {
    await provisionSeoRules(tx, ctx.organizationId);
  });
  return db.query(ctx, query);
}

export async function patchRule(
  ctx: RequestContext,
  ruleId: string,
  patch: { active: boolean },
) {
  return db.one(ctx, sql`
    UPDATE registry_seo_rule SET active = ${patch.active}
    WHERE organization_id = ${ctx.organizationId} AND rule_id = ${ruleId}
    RETURNING rule_id AS "ruleId", rule_group AS "group", severity, active, tested, description
  `);
}

// ─── GSC Metrics ──────────────────────────────────────────────────────────────

export async function getGscMetrics(
  ctx: RequestContext,
  siteId: string,
  opts: { startDate: string; endDate: string; limit?: number },
) {
  await getSite(ctx, siteId);
  return listGscMetrics(ctx, siteId, opts);
}

export async function syncGscData(
  ctx: RequestContext,
  siteId: string,
  _propertyUrl: string,
  startDate: string,
  endDate: string,
) {
  const site = await getSite(ctx, siteId);

  try {
    const registered = await db.one<{ displayUrl: string }>(ctx, sql`
      SELECT display_url FROM seo_sites WHERE organization_id = ${ctx.organizationId} AND id = ${site.id}
    `);
    return await importGscPerformance(ctx, site.id, registered.displayUrl, startDate, endDate, site.client_id);
  } catch (error) {
    if (error instanceof SearchConsoleConfigurationError) throw new ApplicationError(error.message, 422, 'SEO_GSC_CONFIGURATION');
    if (error instanceof SearchConsoleUnavailableError) throw new ApplicationError('Google Search Console is temporarily unavailable. Please retry the sync.', 503, 'SEO_GSC_UNAVAILABLE');
    throw error;
  }
}

