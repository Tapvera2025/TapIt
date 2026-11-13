import type {
  SocialGoogleIndexInspection,
  SocialSearchConsoleDimensionRow,
  SocialSearchConsoleMetricSet,
  SocialSearchConsolePerformance,
} from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import {
  inspectIndexedUrl,
  querySearchAnalytics,
  SearchConsoleConfigurationError,
  SearchConsoleUnavailableError,
} from '../../platform/integrations/google/search-console.js';
import { searchConsoleToken } from './search-console.js';

const ROW_LIMIT = 1000;

function asApplicationError(error: unknown): never {
  if (error instanceof SearchConsoleConfigurationError)
    throw new ApplicationError(error.message, 422, 'SEARCH_CONSOLE_CONFIGURATION');
  if (error instanceof SearchConsoleUnavailableError)
    throw new ApplicationError('Google Search Console is temporarily unavailable. Please retry.', 503, 'SEARCH_CONSOLE_UNAVAILABLE');
  throw error;
}

function metricSet(rows: ReadonlyArray<{ clicks: number; impressions: number; position: number }>): SocialSearchConsoleMetricSet {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = rows.reduce((sum, row) => sum + row.position * row.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    avgPosition: impressions > 0 ? weightedPosition / impressions : null,
  };
}

function dimensionRows(rows: Awaited<ReturnType<typeof querySearchAnalytics>>): SocialSearchConsoleDimensionRow[] {
  return rows.flatMap((row) => {
    const value = row.keys[0];
    return value ? [{ value, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, avgPosition: row.position }] : [];
  });
}

/**
 * Search Console performance for one property, by date, query, page, country
 * and device. The caller has already decided the property belongs to what the
 * person may see (SEO: the website's own property). `pageFilter` limits a
 * domain property to one website's pages.
 */
export async function searchConsolePerformance(
  ctx: RequestContext,
  input: { propertyUrl: string; from: string; to: string; pageFilter?: string | null },
): Promise<SocialSearchConsolePerformance> {
  try {
    const token = await searchConsoleToken(ctx, input.propertyUrl);
    const filters = input.pageFilter
      ? [{ dimension: 'page' as const, operator: 'includingRegex' as const, expression: input.pageFilter }]
      : [];
    const dimensions = ['date', 'query', 'page', 'country', 'device'] as const;
    const groups = await Promise.all(dimensions.map((dimension) => querySearchAnalytics(
      input.propertyUrl,
      { startDate: input.from, endDate: input.to, dimensions: [dimension], rowLimit: ROW_LIMIT, filters },
      token,
    )));
    const daily = groups[0]!.flatMap((row) => {
      const date = row.keys[0];
      return date ? [{ date, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, avgPosition: row.position }] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    const totals = daily.length ? metricSet(daily.map((row) => ({ ...row, position: row.avgPosition ?? 0 }))) : null;
    return {
      propertyUrl: input.propertyUrl,
      startDate: input.from,
      endDate: input.to,
      fetchedAt: new Date().toISOString(),
      latestDataDate: daily.at(-1)?.date ?? null,
      totals,
      daily,
      queries: dimensionRows(groups[1]!),
      pages: dimensionRows(groups[2]!),
      countries: dimensionRows(groups[3]!),
      devices: dimensionRows(groups[4]!),
      rowLimitHit: {
        queries: groups[1]!.length === ROW_LIMIT,
        pages: groups[2]!.length === ROW_LIMIT,
        countries: groups[3]!.length === ROW_LIMIT,
        devices: groups[4]!.length === ROW_LIMIT,
      },
    };
  } catch (error) {
    return asApplicationError(error);
  }
}

function urlCoveredByProperty(rawUrl: string, propertyUrl: string): string {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new ApplicationError('Enter a complete page URL.', 400, 'SEARCH_CONSOLE_INVALID_URL'); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
    throw new ApplicationError('Enter a public HTTP or HTTPS page URL.', 400, 'SEARCH_CONSOLE_INVALID_URL');
  url.hash = '';
  if (propertyUrl.startsWith('sc-domain:')) {
    const domain = propertyUrl.slice('sc-domain:'.length).toLowerCase();
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host !== domain && !host.endsWith(`.${domain}`))
      throw new ApplicationError('The URL must be inside the selected Search Console domain property.', 422, 'SEARCH_CONSOLE_URL_OUTSIDE_PROPERTY');
  } else {
    let prefix: URL;
    try { prefix = new URL(propertyUrl); }
    catch { throw new ApplicationError('The assigned Search Console property is invalid.', 422, 'SEARCH_CONSOLE_CONFIGURATION'); }
    const pathPrefix = prefix.pathname.endsWith('/') ? prefix.pathname.slice(0, -1) : prefix.pathname;
    const pathMatches = url.pathname === pathPrefix || url.pathname.startsWith(`${pathPrefix}/`);
    if (url.origin !== prefix.origin || !pathMatches)
      throw new ApplicationError('The URL must be inside the selected Search Console URL-prefix property.', 422, 'SEARCH_CONSOLE_URL_OUTSIDE_PROPERTY');
  }
  return url.toString();
}

/** Google's index report for one page inside a property. */
export async function inspectSearchConsoleUrl(
  ctx: RequestContext,
  input: { propertyUrl: string; inspectionUrl: string },
): Promise<SocialGoogleIndexInspection> {
  const inspectionUrl = urlCoveredByProperty(input.inspectionUrl, input.propertyUrl);
  try {
    const token = await searchConsoleToken(ctx, input.propertyUrl);
    const result = await inspectIndexedUrl(inspectionUrl, input.propertyUrl, token);
    return {
      inspectionUrl,
      propertyUrl: input.propertyUrl,
      inspectedAt: new Date().toISOString(),
      ...result,
    };
  } catch (error) {
    return asApplicationError(error);
  }
}
