import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { listSites, querySearchAnalytics, SearchConsoleConfigurationError, type SearchConsoleSite } from '../../platform/integrations/google/search-console.js';
import { upsertGscMetrics } from './repository.js';

/** Match the registered website only; never silently import another property. */
export function resolveGscProperty(siteUrl: string, properties: readonly SearchConsoleSite[]): string {
  const site = new URL(siteUrl);
  const matches = properties.filter((property) => {
    if (property.permissionLevel === 'siteUnverifiedUser') return false;
    if (property.siteUrl.startsWith('sc-domain:')) {
      const domain = property.siteUrl.slice('sc-domain:'.length).toLowerCase();
      return site.hostname === domain || site.hostname.endsWith(`.${domain}`);
    }
    try {
      const prefix = new URL(property.siteUrl);
      return site.origin === prefix.origin && site.pathname.startsWith(prefix.pathname);
    } catch { return false; }
  });
  // Prefer a URL-prefix property, then the most specific matching domain.
  matches.sort((a, b) => Number(a.siteUrl.startsWith('sc-domain:')) - Number(b.siteUrl.startsWith('sc-domain:')) || b.siteUrl.length - a.siteUrl.length);
  if (!matches[0]) throw new SearchConsoleConfigurationError('The connected Google account has no verified Search Console property covering this website. Grant it access to the matching property.');
  return matches[0].siteUrl;
}

export async function importGscPerformance(ctx: RequestContext, siteId: string, siteUrl: string, startDate: string, endDate: string) {
  const propertyUrl = resolveGscProperty(siteUrl, await listSites());
  const pageSize = 25_000;
  const maxPages = 10;
  const observations: Parameters<typeof upsertGscMetrics>[1] = [];
  let rowLimitHit = false;
  for (let page = 0; page < maxPages; page++) {
    const rows = await querySearchAnalytics(propertyUrl, {
      startDate, endDate, dimensions: ['date', 'query', 'page', 'country', 'device'],
      rowLimit: pageSize, startRow: page * pageSize,
      // A domain property may include other subdomains. Restrict to this site.
      filters: [{ dimension: 'page', operator: 'contains', expression: new URL(siteUrl).origin + '/' }],
    });
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
