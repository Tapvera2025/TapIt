/**
 * Live Google (and Bing / local-pack) rank checks for a project's keywords.
 *
 * Search Console answers "on average, over a window", and never for a city, for
 * Bing, or for the local pack. A live check asks a search provider (SerpApi)
 * where the project's website is on the results page right now, for the
 * keyword's own country, city and device, and records the exact position and
 * the page that ranked.
 *
 * SerpApi is primary. Search Console is the fallback used only when a live
 * check cannot run (no key, provider down, or the allowance is used up) and the
 * keyword is one Search Console can serve. A live check that runs and does not
 * find the site is a real answer ("not in the first N results"), not a reason
 * to fall back.
 *
 * Paid per results page, so each project has an explicit monthly allowance;
 * 0 (the default) disables live checks. Every requested page is counted,
 * failures included, under a row lock so two people cannot overspend it.
 */
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { systemClock } from '../../../platform/time.js';
import { searchConsoleConnected, searchConsoleToken } from '../../social/facade.js';
import {
  SearchConsoleConfigurationError,
  SearchConsoleUnavailableError,
} from '../../../platform/integrations/google/search-console.js';
import {
  checkLiveRank,
  clampDepth,
  hostOf,
  LIVE_PROVIDER,
  type LiveRankQuery,
  type LiveRankResult,
  type LiveTopResult,
} from '../../../platform/integrations/serpapi/live-rank.js';
import { ProjectNotFoundError, ProjectValidationError } from '../errors.js';
import { findProjectById } from '../repository.js';
import { searchConsoleProvider } from './search-console-provider.js';
import { observationWindow } from './sync.js';
import {
  applyAutomaticObservation,
  findSearchConsoleLink,
  markFetchOutcome,
  type KeywordRow,
  type ReportContext,
} from './repository.js';
import { keywordSelect } from './repository.js';

export interface ProjectSeoSettings {
  /** The website set on the project, if any. */
  readonly websiteUrl: string | null;
  /** The host live checks look for when a keyword names no target URL. */
  readonly effectiveHost: string | null;
  /** Where `effectiveHost` came from. */
  readonly websiteSource: 'project' | 'search-console' | null;
  readonly monthlyLimit: number;
  readonly searchDepth: number;
  readonly used: number;
  readonly remaining: number;
  readonly configured: boolean;
  readonly provider: string;
}

const MONTH_START = sql`date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export async function getProjectSeoSettings(
  ctx: RequestContext,
  projectId: string,
): Promise<ProjectSeoSettings> {
  if (!(await findProjectById(ctx, projectId))) throw new ProjectNotFoundError();
  const row = await db.maybeOne<{ websiteUrl: string | null; monthlyLimit: number; searchDepth: number }>(
    ctx,
    sql`SELECT website_url AS "websiteUrl", monthly_search_limit AS "monthlyLimit", search_depth AS "searchDepth"
      FROM project_seo_settings WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId}`,
  );
  const used = (
    await db.one<{ count: number }>(
      ctx,
      sql`SELECT count(*)::integer AS count FROM project_seo_serp_request
        WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId}
          AND requested_at >= ${MONTH_START}`,
    )
  ).count;
  const monthlyLimit = row?.monthlyLimit ?? 0;
  const websiteUrl = row?.websiteUrl ?? null;
  let effectiveHost = hostOf(websiteUrl);
  let websiteSource: ProjectSeoSettings['websiteSource'] = effectiveHost ? 'project' : null;
  if (!effectiveHost) {
    // The Search Console property linked to the project names its website.
    const link = await findSearchConsoleLink(ctx, projectId);
    effectiveHost = hostOf(link?.propertyUrl);
    if (effectiveHost) websiteSource = 'search-console';
  }
  return {
    websiteUrl,
    effectiveHost,
    websiteSource,
    monthlyLimit,
    searchDepth: row?.searchDepth ?? 30,
    used,
    remaining: Math.max(0, monthlyLimit - used),
    configured: Boolean(process.env['SERPAPI_API_KEY']),
    provider: LIVE_PROVIDER,
  };
}

export async function updateProjectSeoSettings(
  ctx: RequestContext,
  projectId: string,
  patch: {
    websiteUrl?: string | null | undefined;
    monthlyLimit?: number | undefined;
    searchDepth?: number | undefined;
  },
): Promise<ProjectSeoSettings> {
  if (!(await findProjectById(ctx, projectId))) throw new ProjectNotFoundError();
  let websiteUrl: string | null = null;
  if (patch.websiteUrl != null && patch.websiteUrl.trim() !== '') {
    if (hostOf(patch.websiteUrl) === null)
      throw new ProjectValidationError('Enter the website as a full address, e.g. https://example.com.');
    websiteUrl = patch.websiteUrl.trim();
  }
  await db.query(
    ctx,
    sql`INSERT INTO project_seo_settings (organization_id, project_id, website_url, monthly_search_limit, search_depth, updated_by, updated_at)
      VALUES (${ctx.organizationId}, ${projectId}, ${websiteUrl}, ${patch.monthlyLimit ?? 0}, ${patch.searchDepth ?? 30}, ${ctx.principal.id}, now())
      ON CONFLICT (organization_id, project_id) DO UPDATE SET
        website_url = CASE WHEN ${patch.websiteUrl !== undefined} THEN EXCLUDED.website_url ELSE project_seo_settings.website_url END,
        monthly_search_limit = CASE WHEN ${patch.monthlyLimit !== undefined} THEN EXCLUDED.monthly_search_limit ELSE project_seo_settings.monthly_search_limit END,
        search_depth = CASE WHEN ${patch.searchDepth !== undefined} THEN EXCLUDED.search_depth ELSE project_seo_settings.search_depth END,
        updated_by = ${ctx.principal.id}, updated_at = now()`,
  );
  return getProjectSeoSettings(ctx, projectId);
}

/** Reserves one results page against the month's allowance, under a row lock.
 * Returns false when the allowance is exhausted; the caller stops there. */
async function reservePage(
  ctx: RequestContext,
  projectId: string,
  keywordId: string,
): Promise<boolean> {
  return db.transaction(ctx, async (tx) => {
    const settings = await tx.maybeOne<{ monthlyLimit: number }>(
      sql`SELECT monthly_search_limit AS "monthlyLimit" FROM project_seo_settings
        WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId} FOR UPDATE`,
    );
    const limit = settings?.monthlyLimit ?? 0;
    if (limit === 0) return false;
    const used = await tx.one<{ count: number }>(
      sql`SELECT count(*)::integer AS count FROM project_seo_serp_request
        WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId}
          AND requested_at >= ${MONTH_START}`,
    );
    if (used.count >= limit) return false;
    await tx.query(
      sql`INSERT INTO project_seo_serp_request (organization_id, project_id, keyword_id, requested_by)
        VALUES (${ctx.organizationId}, ${projectId}, ${keywordId}, ${ctx.principal.id})`,
    );
    return true;
  });
}

export interface LiveCheckOutcome {
  readonly source: 'live' | 'search-console';
  readonly status: 'found' | 'not-found' | 'failed';
  readonly position: number | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly location: string;
  readonly engine: string;
  readonly device: string;
  readonly resultsChecked: number | null;
  readonly pagesRequested: number;
  readonly topResults: readonly LiveTopResult[];
  readonly message: string | null;
  readonly usedFallback: boolean;
}

function liveTargetHost(keyword: KeywordRow, settings: ProjectSeoSettings): string {
  const host = hostOf(keyword.targetUrl) ?? settings.effectiveHost;
  if (!host)
    throw new ProjectValidationError(
      'Add a target URL to this keyword, or set the project website in the live-check settings, so the check knows which website to look for.',
    );
  return host;
}

/** Writes a live observation and moves the keyword's rolling rank slots. */
async function recordLive(
  ctx: RequestContext,
  projectId: string,
  keyword: KeywordRow,
  result: LiveRankResult,
): Promise<void> {
  const found = result.status === 'found';
  const checked = result.status === 'failed' ? null : result.resultsChecked;
  await db.transaction(ctx, async (tx) => {
    if (result.status !== 'failed') {
      await tx.query(sql`
        INSERT INTO project_seo_rank_history
          (organization_id, keyword_id, observed_rank, source, status, created_by, provider,
           ranking_url, search_location, results_checked, unavailable_reason)
        VALUES (${ctx.organizationId}, ${keyword.id}, ${found ? result.position : null}, 'live',
          ${found ? 'available' : 'unavailable'}, ${ctx.principal.id}, ${LIVE_PROVIDER},
          ${found ? result.url : null}, ${result.location}, ${checked},
          ${found ? null : 'not-ranked'})`);
    }
    await tx.query(sql`
      UPDATE project_seo_keyword SET
        last_live_check_at = now(),
        last_live_outcome = ${result.status},
        last_live_position = ${found ? result.position : null},
        last_live_url = ${found ? result.url : null},
        last_live_location = ${result.location},
        last_live_depth = ${checked},
        last_live_message = ${result.status === 'failed' ? result.message.slice(0, 1000) : null},
        past_rank = CASE WHEN ${found} THEN previous_rank ELSE past_rank END,
        previous_rank = CASE WHEN ${found} THEN current_rank ELSE previous_rank END,
        current_rank = CASE WHEN ${found} THEN ${found ? result.position : null}::integer ELSE current_rank END,
        last_checked_at = CASE WHEN ${result.status !== 'failed'} THEN now() ELSE last_checked_at END,
        updated_at = now()
      WHERE organization_id = ${ctx.organizationId} AND project_id = ${projectId}
        AND id = ${keyword.id} AND archived_at IS NULL`);
  });
}

/** Search Console fallback: the one keyword's average position over the window,
 * recorded through the same automatic-observation path the scheduler uses. */
async function searchConsoleFallback(
  ctx: RequestContext,
  projectId: string,
  keyword: KeywordRow,
): Promise<LiveCheckOutcome | null> {
  if (keyword.searchEngine !== 'google' || keyword.category === 'gmb') return null;
  if ((keyword.city ?? '').trim() !== '') return null;
  if (!(await searchConsoleConnected(ctx))) return null;
  const link = await findSearchConsoleLink(ctx, projectId);
  if (!link) return null;
  const provider = searchConsoleProvider();
  const request = {
    keywordId: keyword.id,
    keyword: keyword.keyword,
    targetUrl: keyword.targetUrl,
    searchEngine: keyword.searchEngine,
    category: keyword.category,
    country: keyword.country,
    city: keyword.city,
    device: keyword.device,
  };
  if (!provider.supports(request).ok) return null;
  const window = await observationWindow(ctx, systemClock);
  try {
    const token = await searchConsoleToken(ctx, link.propertyUrl);
    const [result] = await provider.fetchRanks(
      { propertyUrl: link.propertyUrl, accessToken: token },
      [request],
      window,
    );
    if (!result || result.status !== 'available') return null;
    await db.transaction(ctx, async (tx) => {
      await applyAutomaticObservation(tx, ctx, {
        keywordId: keyword.id,
        provider: provider.name,
        windowStart: window.start,
        windowEnd: window.end,
        rank: result.position,
        exactPosition: result.exactPosition,
        impressions: result.impressions,
        clicks: result.clicks,
        ctr: result.ctr,
        unavailableReason: null,
      });
      await markFetchOutcome(tx, ctx, keyword.id, 'ok', null);
    });
    return {
      source: 'search-console',
      status: 'found',
      position: result.position,
      url: keyword.targetUrl,
      title: null,
      location: keyword.country,
      engine: 'google',
      device: keyword.device,
      resultsChecked: null,
      pagesRequested: 0,
      topResults: [],
      message: `A live check could not run, so this is Google Search Console’s average position for ${window.start} to ${window.end}.`,
      usedFallback: true,
    };
  } catch (error) {
    if (error instanceof SearchConsoleUnavailableError || error instanceof SearchConsoleConfigurationError)
      return null;
    throw error;
  }
}

/** Runs a live check for one stored project keyword, falling back to Search
 * Console when the live check cannot run. */
export async function checkKeywordLiveRank(
  ctx: RequestContext,
  projectId: string,
  keyword: KeywordRow,
): Promise<LiveCheckOutcome> {
  const project = await findProjectById(ctx, projectId);
  if (!project) throw new ProjectNotFoundError();
  const settings = await getProjectSeoSettings(ctx, projectId);
  const targetHost = liveTargetHost(keyword, settings);
  const apiKey = process.env['SERPAPI_API_KEY'] ?? '';
  const query: LiveRankQuery = {
    keyword: keyword.keyword,
    searchEngine: keyword.searchEngine,
    category: keyword.category,
    country: keyword.country,
    city: keyword.city,
    device: keyword.device,
    targetHost,
    // A local-pack listing without a website is matched by the client's business name.
    businessName: keyword.category === 'gmb' ? project.businessName || project.clientName || null : null,
    depth: clampDepth(settings.searchDepth),
  };

  const result: LiveRankResult = apiKey
    ? await checkLiveRank(query, { apiKey, beforePage: () => reservePage(ctx, projectId, keyword.id) })
    : {
        status: 'failed',
        message: 'Live search is not configured on the server (SERPAPI_API_KEY).',
        pagesRequested: 0,
        allowanceExhausted: false,
        engine: keyword.category === 'gmb' ? 'google_local' : keyword.searchEngine === 'bing' ? 'bing' : 'google',
        location: keyword.city ? `${keyword.city}, ${keyword.country}` : keyword.country,
      };

  await recordLive(ctx, projectId, keyword, result);

  const common = { engine: result.engine, device: keyword.device, pagesRequested: result.pagesRequested };
  if (result.status === 'failed') {
    const fallback = await searchConsoleFallback(ctx, projectId, keyword);
    if (fallback) return fallback;
    return {
      ...common,
      source: 'live',
      status: 'failed',
      position: null,
      url: null,
      title: null,
      location: result.location,
      resultsChecked: null,
      topResults: [],
      message: result.message,
      usedFallback: false,
    };
  }
  return {
    ...common,
    source: 'live',
    status: result.status,
    position: result.status === 'found' ? result.position : null,
    url: result.status === 'found' ? result.url : null,
    title: result.status === 'found' ? result.title : null,
    location: result.location,
    resultsChecked: result.resultsChecked,
    topResults: result.topResults,
    message:
      result.status === 'not-found'
        ? `Not in the first ${result.resultsChecked} results for ${result.location}.`
        : null,
    usedFallback: false,
  };
}

/** Every active keyword of the project, with its latest live reading — the
 * "check an existing project" view. Not limited to a reporting period. */
export async function listProjectRankings(ctx: RequestContext, projectId: string) {
  const project = await findProjectById(ctx, projectId);
  if (!project) throw new ProjectNotFoundError();
  const scoped: ReportContext = { ...ctx, projectId };
  const [settings, keywords] = await Promise.all([
    getProjectSeoSettings(ctx, projectId),
    db.query<KeywordRow>(
      scoped,
      sql`${keywordSelect()} WHERE k.organization_id = ${ctx.organizationId} AND k.project_id = ${projectId}
        AND k.archived_at IS NULL
        ORDER BY CASE k.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, lower(k.keyword), k.created_at
        LIMIT 500`,
    ),
  ]);
  return {
    project: {
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      businessName: project.businessName,
    },
    settings,
    keywords,
  };
}
