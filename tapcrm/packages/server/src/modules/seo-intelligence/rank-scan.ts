/**
 * "Scan a website" in Keyword search: where one of the organization's SEO
 * websites ranks right now for a keyword, in a country or city, on a device,
 * on Google (organic or the local map pack) or Bing.
 *
 * A scan is paid per results page, so it spends from the website's own monthly
 * search allowance (seo_serp_allowance), the same budget the scheduled position
 * checks use, under the same row lock. Its request rows carry purpose 'scan'.
 * Every scan that reached the provider is kept in seo_rank_scan, failures
 * included: they were paid for too.
 */
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  checkLiveRank,
  clampDepth,
  engineFor,
  hostOf,
  liveCountry,
  liveLocation,
  type LiveRankResult,
  type LiveTopResult,
} from '../../platform/integrations/serpapi/live-rank.js';
import { SeoSiteValidationError } from './errors.js';
import { getSite } from './repository.js';
import { getSerpAllowance } from './serp-allowance.js';
import type { RankScanInput } from './validators.js';

export interface SeoRankScan {
  readonly id: string;
  readonly keyword: string;
  readonly engine: 'google' | 'bing' | 'google_local';
  readonly country: string;
  readonly city: string | null;
  readonly searchLocation: string;
  readonly device: 'desktop' | 'mobile';
  readonly depth: number;
  readonly status: 'found' | 'not-found' | 'failed';
  readonly position: number | null;
  readonly rankingUrl: string | null;
  readonly rankingTitle: string | null;
  readonly resultsChecked: number | null;
  readonly pagesRequested: number;
  readonly topResults: readonly LiveTopResult[];
  readonly message: string | null;
  readonly requestedByName: string | null;
  readonly createdAt: string;
}

const MONTH_START = sql`date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

const SELECT_SCAN = sql`
  SELECT s.id, s.keyword, s.engine, s.country, s.city, s.search_location, s.device, s.depth,
    s.status, s.position, s.ranking_url, s.ranking_title, s.results_checked, s.pages_requested,
    s.top_results, s.message, u.full_name AS requested_by_name, s.created_at
  FROM seo_rank_scan s
  LEFT JOIN app_user u ON u.organization_id = s.organization_id AND u.id = s.requested_by`;

/** One results page reserved against the website's monthly allowance. */
async function reserveScanPage(ctx: RequestContext, siteId: string): Promise<boolean> {
  return db.transaction(ctx, async (tx) => {
    const allowance = await tx.maybeOne<{ monthlySearchLimit: number }>(sql`
      SELECT monthly_search_limit FROM seo_serp_allowance
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} FOR UPDATE`);
    if (!allowance || allowance.monthlySearchLimit === 0) return false;
    const used = await tx.one<{ count: number }>(sql`
      SELECT count(*)::integer AS count FROM seo_serp_search_request
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
        AND requested_at >= ${MONTH_START}`);
    if (used.count >= allowance.monthlySearchLimit) return false;
    await tx.query(sql`
      INSERT INTO seo_serp_search_request (organization_id, site_id, keyword_id, purpose)
      VALUES (${ctx.organizationId}, ${siteId}, NULL, 'scan')`);
    return true;
  });
}

function allowanceMessage(): string {
  return 'This website’s monthly search allowance is used up or not set. An administrator can set it under Settings → Crawl & data sources.';
}

export async function scanSiteRank(
  ctx: RequestContext,
  siteId: string,
  input: RankScanInput,
): Promise<{ scan: SeoRankScan; allowance: { monthlyLimit: number; used: number; remaining: number } }> {
  const site = await getSite(ctx, siteId);
  const details = await db.one<{ displayUrl: string; active: boolean; businessName: string | null }>(ctx, sql`
    SELECT s.display_url, s.active, c.business_name
    FROM seo_sites s
    LEFT JOIN client c ON c.organization_id = s.organization_id AND c.id = s.client_id
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${site.id}`);
  if (!details.active) throw new SeoSiteValidationError('This website is inactive. Activate it before scanning.');
  const targetHost = hostOf(details.displayUrl);
  if (!targetHost) throw new SeoSiteValidationError('This website’s address cannot be searched for.');
  if (liveCountry(input.country) === undefined)
    throw new SeoSiteValidationError(`“${input.country}” is not a country the scan knows. Use a country name or its two-letter code.`);
  const apiKey = process.env['SERPAPI_API_KEY'] ?? '';
  if (!apiKey)
    throw new ApplicationError('Live search (SerpApi) is not configured on the server.', 422, 'SEO_SERP_CONFIGURATION');
  const before = await getSerpAllowance(ctx, siteId);
  if (before.remaining === 0) throw new ApplicationError(allowanceMessage(), 429, 'SEO_SERP_LIMIT');

  const city = input.city?.trim() || null;
  const depth = clampDepth(input.depth);
  const result: LiveRankResult = await checkLiveRank(
    {
      keyword: input.keyword,
      searchEngine: input.searchEngine,
      category: input.category,
      country: input.country,
      city,
      device: input.device,
      targetHost,
      businessName: input.category === 'gmb' ? details.businessName : null,
      depth,
    },
    { apiKey, beforePage: () => reserveScanPage(ctx, siteId) },
  );

  const found = result.status === 'found';
  const location = result.location || liveLocation(city, liveCountry(input.country) ?? null);
  const row = await db.one<{ id: string }>(ctx, sql`
    INSERT INTO seo_rank_scan
      (organization_id, site_id, keyword, engine, country, city, search_location, device, depth,
       status, position, ranking_url, ranking_title, results_checked, pages_requested, top_results,
       message, requested_by)
    VALUES (${ctx.organizationId}, ${siteId}, ${input.keyword}, ${engineFor(input)}, ${input.country}, ${city},
      ${location.slice(0, 300)}, ${input.device}, ${depth}, ${result.status},
      ${found ? result.position : null}, ${found ? (result.url?.slice(0, 2000) ?? null) : null},
      ${found ? (result.title?.slice(0, 500) ?? null) : null},
      ${result.status === 'failed' ? null : result.resultsChecked}, ${result.pagesRequested},
      ${JSON.stringify(result.status === 'failed' ? [] : result.topResults.map((item) => ({
        position: item.position,
        url: item.url?.slice(0, 2000) ?? null,
        title: item.title?.slice(0, 500) ?? null,
      })))}::jsonb,
      ${result.status === 'failed' ? result.message.slice(0, 1000) : result.status === 'not-found' ? `Not in the first ${result.resultsChecked} results for ${location}.` : null},
      ${ctx.principal.id})
    RETURNING id`);
  const scan = await db.one<SeoRankScan>(ctx, sql`${SELECT_SCAN}
    WHERE s.organization_id = ${ctx.organizationId} AND s.id = ${row.id}`);
  return { scan, allowance: await getSerpAllowance(ctx, siteId) };
}

export async function listRankScans(ctx: RequestContext, siteId: string, limit = 50): Promise<SeoRankScan[]> {
  await getSite(ctx, siteId);
  return db.query<SeoRankScan>(ctx, sql`${SELECT_SCAN}
    WHERE s.organization_id = ${ctx.organizationId} AND s.site_id = ${siteId}
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}`);
}
