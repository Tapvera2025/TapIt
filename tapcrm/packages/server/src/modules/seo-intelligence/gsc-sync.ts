import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { querySearchAnalytics, SearchConsoleConfigurationError, type SearchConsoleSite } from '../../platform/integrations/google/search-console.js';
import { listSearchConsoleProperties, searchConsoleToken, type SearchConsolePropertyAccess } from '../social/facade.js';
import { upsertGscMetrics } from './repository.js';
import { sql } from '../../platform/dal/sql.js';
import { hostKey } from './url.js';

/**
 * Match the registered website only; never silently import another property.
 * The www. and bare forms of a host are the same website (the crawler treats
 * them so too); an exact URL-prefix match still wins over the www. variant.
 */
export function resolveGscProperty(siteUrl: string, properties: readonly SearchConsoleSite[]): string {
  const site = new URL(siteUrl);
  const rank = (property: SearchConsoleSite): number | null => {
    if (property.permissionLevel === 'siteUnverifiedUser') return null;
    if (property.siteUrl.startsWith('sc-domain:')) {
      const domain = property.siteUrl.slice('sc-domain:'.length).toLowerCase();
      return site.hostname === domain || site.hostname.endsWith(`.${domain}`) ? 2 : null;
    }
    try {
      const prefix = new URL(property.siteUrl);
      if (!site.pathname.startsWith(prefix.pathname) || site.protocol !== prefix.protocol) return null;
      if (site.origin === prefix.origin) return 0;
      return hostKey(site.hostname) === hostKey(prefix.hostname) && site.port === prefix.port ? 1 : null;
    } catch { return null; }
  };
  const matches = properties.filter((property) => rank(property) !== null);
  // Exact URL prefix, then the www. variant, then the most specific matching domain.
  matches.sort((a, b) => rank(a)! - rank(b)! || b.siteUrl.length - a.siteUrl.length);
  if (!matches[0]) throw new SearchConsoleConfigurationError('None of your organization’s Google logins can read a Search Console property covering this website. Connect the Google account that manages it under Social → Company connections, or add one of your logins as a user of the property.');
  return matches[0].siteUrl;
}

/**
 * The property for a website, among those the ORGANIZATION's own Google logins can
 * read (Social → Company connections). Properties assigned to the website's client
 * are tried first, so two clients on related domains each get their own.
 */
export function chooseGscProperty(siteUrl: string, properties: readonly SearchConsolePropertyAccess[], clientId: string | null): string {
  const asSites = (list: readonly SearchConsolePropertyAccess[]) =>
    list.map((property) => ({ siteUrl: property.propertyUrl, permissionLevel: property.permissionLevel }));
  const own = clientId === null ? [] : properties.filter((property) => property.clientId === clientId);
  if (own.length > 0) {
    try {
      return resolveGscProperty(siteUrl, asSites(own));
    } catch (error) {
      if (!(error instanceof SearchConsoleConfigurationError)) throw error;
    }
  }
  return resolveGscProperty(siteUrl, asSites(properties));
}

export async function importGscPerformance(ctx: RequestContext, siteId: string, siteUrl: string, startDate: string, endDate: string, clientId: string | null = null) {
  const { properties, problem } = await listSearchConsoleProperties(ctx);
  let propertyUrl: string;
  try {
    propertyUrl = chooseGscProperty(siteUrl, properties, clientId);
  } catch (error) {
    // Nothing matched because the shared login could not list its properties: say that.
    throw problem ?? error;
  }
  const accessToken = await searchConsoleToken(ctx, propertyUrl);
  const pageSize = 25_000;
  const maxPages = 10;
  const observations: Parameters<typeof upsertGscMetrics>[1] = [];
  let rowLimitHit = false;
  for (let page = 0; page < maxPages; page++) {
    const rows = await querySearchAnalytics(propertyUrl, {
      startDate, endDate, dimensions: ['date', 'query', 'page', 'country', 'device'],
      rowLimit: pageSize, startRow: page * pageSize,
      // A domain property may include other subdomains. Restrict to this site,
      // with or without www. and on either scheme.
      filters: [{ dimension: 'page', operator: 'includingRegex', expression: sitePageRegex(siteUrl) }],
    }, accessToken);
    for (const row of rows) {
      const [date, query, pageUrl, country, device] = row.keys;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !query || !pageUrl || !country || !device) throw new Error('Search Console returned an unexpected dimension layout.');
      observations.push({ id: randomUUID(), organizationId: ctx.organizationId, siteId, propertyUrl, date,
        searchType: 'web', query, page: pageUrl, country, device,
        clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, avgPosition: row.position,
        // The API reports selected query rows, not every query Google knows.
        dataComplete: false, rowLimitHit: false });
    }
    if (rows.length < pageSize) break;
    if (page === maxPages - 1) rowLimitHit = true;
  }
  for (const row of observations) row.rowLimitHit = rowLimitHit;
  await db.transaction(ctx, async (tx) => { await upsertGscMetrics(tx, observations); });
  return { state: 'ok' as const, synced: observations.length, propertyUrl, rowLimitHit };
}

/** RE2 pattern matching this site's pages on http(s), with or without www. */
export function sitePageRegex(siteUrl: string): string {
  const url = new URL(siteUrl);
  const host = hostKey(url.hostname).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const port = url.port ? `:${url.port}` : '';
  return `^https?://(www\\.)?${host}${port}/`;
}

/**
 * The days to import: 90 days the first time, then from four days before the
 * newest stored day (Search Console keeps revising recent days) to today.
 */
export async function gscSyncWindow(ctx: RequestContext, siteId: string, now = new Date()): Promise<{ startDate: string; endDate: string }> {
  const row = await db.maybeOne<{ latest: string | null }>(ctx, sql`
    SELECT max(date)::text AS latest FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
  `);
  const endDate = now.toISOString().slice(0, 10);
  const fullStart = new Date(now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  if (!row?.latest) return { startDate: fullStart, endDate };
  const resume = new Date(Date.parse(`${row.latest}T00:00:00Z`) - 4 * 86_400_000).toISOString().slice(0, 10);
  return { startDate: resume > fullStart ? resume : fullStart, endDate };
}

/** Search Console itself keeps 16 months; older rows are dropped. */
export async function pruneGscMetrics(ctx: RequestContext, siteId: string): Promise<void> {
  await db.query(ctx, sql`
    DELETE FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
      AND date < (current_date - interval '16 months')::date
  `);
}
