import type {
  SocialGoogleIndexInspection,
  SocialSearchConsoleDimensionRow,
  SocialSearchConsoleMetricSet,
  SocialSearchConsolePerformance,
  SocialSearchConsoleProperty,
} from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import {
  inspectIndexedUrl,
  querySearchAnalytics,
  SearchConsoleConfigurationError,
  SearchConsoleUnavailableError,
} from '../../platform/integrations/google/search-console.js';
import { listSearchConsoleProperties, searchConsoleToken } from './search-console.js';

const ROW_LIMIT = 1000;

function asApplicationError(error: unknown): never {
  if (error instanceof SearchConsoleConfigurationError)
    throw new ApplicationError(error.message, 422, 'SOCIAL_SEARCH_CONSOLE_CONFIGURATION');
  if (error instanceof SearchConsoleUnavailableError)
    throw new ApplicationError('Google Search Console is temporarily unavailable. Please retry.', 503, 'SOCIAL_SEARCH_CONSOLE_UNAVAILABLE');
  throw error;
}

export async function listClientSearchConsoleProperties(
  ctx: RequestContext,
  clientId: string,
): Promise<{ properties: SocialSearchConsoleProperty[]; warning: string | null }> {
  const result = await listSearchConsoleProperties(ctx);
  return {
    properties: result.properties
      .filter((property) => property.clientId === clientId)
      .map(({ propertyUrl, permissionLevel, status }) => ({ propertyUrl, permissionLevel, status })),
    warning: result.problem?.message ?? null,
  };
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

async function assignedProperty(ctx: RequestContext, clientId: string, propertyUrl: string) {
  const { properties } = await listSearchConsoleProperties(ctx);
  const property = properties.find((item) => item.clientId === clientId && item.propertyUrl === propertyUrl);
  if (!property)
    throw new ApplicationError('That Search Console property is not assigned to this client.', 404, 'SOCIAL_SEARCH_CONSOLE_PROPERTY_NOT_FOUND');
  if (property.permissionLevel === 'siteUnverifiedUser')
    throw new ApplicationError('The connected Google account cannot read this Search Console property.', 422, 'SOCIAL_SEARCH_CONSOLE_CONFIGURATION');
  return property;
}

export async function getClientSearchConsolePerformance(
  ctx: RequestContext,
  clientId: string,
  input: { propertyUrl: string; from: string; to: string },
): Promise<SocialSearchConsolePerformance> {
  await assignedProperty(ctx, clientId, input.propertyUrl);
  try {
    const token = await searchConsoleToken(ctx, input.propertyUrl);
    const dimensions = ['date', 'query', 'page', 'country', 'device'] as const;
    const groups = await Promise.all(dimensions.map((dimension) => querySearchAnalytics(
      input.propertyUrl,
      { startDate: input.from, endDate: input.to, dimensions: [dimension], rowLimit: ROW_LIMIT },
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
  catch { throw new ApplicationError('Enter a complete page URL.', 400, 'SOCIAL_SEARCH_CONSOLE_INVALID_URL'); }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password)
    throw new ApplicationError('Enter a public HTTP or HTTPS page URL.', 400, 'SOCIAL_SEARCH_CONSOLE_INVALID_URL');
  url.hash = '';
  if (propertyUrl.startsWith('sc-domain:')) {
    const domain = propertyUrl.slice('sc-domain:'.length).toLowerCase();
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host !== domain && !host.endsWith(`.${domain}`))
      throw new ApplicationError('The URL must be inside the selected Search Console domain property.', 422, 'SOCIAL_SEARCH_CONSOLE_URL_OUTSIDE_PROPERTY');
  } else {
    let prefix: URL;
    try { prefix = new URL(propertyUrl); }
    catch { throw new ApplicationError('The assigned Search Console property is invalid.', 422, 'SOCIAL_SEARCH_CONSOLE_CONFIGURATION'); }
    const pathPrefix = prefix.pathname.endsWith('/') ? prefix.pathname.slice(0, -1) : prefix.pathname;
    const pathMatches = url.pathname === pathPrefix || url.pathname.startsWith(`${pathPrefix}/`);
    if (url.origin !== prefix.origin || !pathMatches)
      throw new ApplicationError('The URL must be inside the selected Search Console URL-prefix property.', 422, 'SOCIAL_SEARCH_CONSOLE_URL_OUTSIDE_PROPERTY');
  }
  return url.toString();
}

export async function inspectClientSearchConsoleUrl(
  ctx: RequestContext,
  clientId: string,
  input: { propertyUrl: string; inspectionUrl: string },
): Promise<SocialGoogleIndexInspection> {
  await assignedProperty(ctx, clientId, input.propertyUrl);
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
