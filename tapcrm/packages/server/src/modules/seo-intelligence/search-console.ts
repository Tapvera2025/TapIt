/**
 * Google Search Console reporting for an SEO website: clicks, appearances,
 * click-through rate and average position by day, search term, page, country
 * and device, read live from Google, plus Google's index report for one page.
 *
 * This used to sit under Social → Analytics per client. It belongs to the
 * website, so the property is the one the website's own address resolves to
 * among those the organization's Google logins can read (Social → Company
 * connections), the website's client's own properties first — the same choice
 * "Import latest Google data" makes. A domain property is narrowed to this
 * website's pages.
 */
import type { SocialGoogleIndexInspection, SocialSearchConsolePerformance } from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { SearchConsoleConfigurationError } from '../../platform/integrations/google/search-console.js';
import {
  inspectSearchConsoleUrl,
  listSearchConsoleProperties,
  searchConsoleConnected,
  searchConsolePerformance,
} from '../social/facade.js';
import { chooseGscProperty, sitePageRegex } from './gsc-sync.js';
import { getSite } from './repository.js';
import { hostKey } from './url.js';

export interface SiteSearchConsoleProperty {
  readonly propertyUrl: string;
  readonly permissionLevel: string;
  readonly status: 'connected' | 'reconnect_required';
  readonly account: string | null;
}

export interface SiteSearchConsoleReport {
  readonly website: string;
  readonly property: SiteSearchConsoleProperty | null;
  /** Why there is no report, in words a person can act on. */
  readonly problem: string | null;
  readonly performance: SocialSearchConsolePerformance | null;
}

async function siteAddress(ctx: RequestContext, siteId: string) {
  const site = await getSite(ctx, siteId);
  return db.one<{ id: string; displayUrl: string; clientId: string | null }>(ctx, sql`
    SELECT id, display_url, client_id FROM seo_sites
    WHERE organization_id = ${ctx.organizationId} AND id = ${site.id}`);
}

async function resolveProperty(
  ctx: RequestContext,
  site: { displayUrl: string; clientId: string | null },
): Promise<{ property: SiteSearchConsoleProperty | null; problem: string | null }> {
  if (!(await searchConsoleConnected(ctx)))
    return {
      property: null,
      problem: 'No Google login is connected. An administrator can connect the Google account that manages this website under Social → Company connections.',
    };
  const { properties, problem } = await listSearchConsoleProperties(ctx);
  let propertyUrl: string;
  try {
    propertyUrl = chooseGscProperty(site.displayUrl, properties, site.clientId);
  } catch (error) {
    if (!(error instanceof SearchConsoleConfigurationError)) throw error;
    return { property: null, problem: problem?.message ?? error.message };
  }
  const match = properties.find((item) => item.propertyUrl === propertyUrl)!;
  return {
    property: {
      propertyUrl,
      permissionLevel: match.permissionLevel,
      status: match.status,
      account: match.account ?? null,
    },
    problem:
      match.status === 'reconnect_required'
        ? 'The Google login for this website’s Search Console property needs to be reconnected under Social → Company connections.'
        : null,
  };
}

/** A domain property can hold other websites; keep to this one's pages. */
function pageFilterFor(propertyUrl: string, displayUrl: string): string | null {
  return propertyUrl.startsWith('sc-domain:') ? sitePageRegex(displayUrl) : null;
}

export async function getSiteSearchConsoleReport(
  ctx: RequestContext,
  siteId: string,
  range: { from: string; to: string },
): Promise<SiteSearchConsoleReport> {
  const site = await siteAddress(ctx, siteId);
  const { property, problem } = await resolveProperty(ctx, site);
  if (!property || problem) return { website: site.displayUrl, property, problem, performance: null };
  const performance = await searchConsolePerformance(ctx, {
    propertyUrl: property.propertyUrl,
    from: range.from,
    to: range.to,
    pageFilter: pageFilterFor(property.propertyUrl, site.displayUrl),
  });
  return { website: site.displayUrl, property, problem: null, performance };
}

export async function inspectSiteUrl(
  ctx: RequestContext,
  siteId: string,
  input: { inspectionUrl: string },
): Promise<SocialGoogleIndexInspection> {
  const site = await siteAddress(ctx, siteId);
  let page: URL;
  try {
    page = new URL(input.inspectionUrl);
  } catch {
    throw new ApplicationError('Enter a complete page address, e.g. https://example.com/about.', 400, 'SEO_GSC_INVALID_URL');
  }
  if (hostKey(page.hostname) !== hostKey(new URL(site.displayUrl).hostname))
    throw new ApplicationError('Enter a page on this website.', 422, 'SEO_GSC_URL_OUTSIDE_SITE');
  const { property, problem } = await resolveProperty(ctx, site);
  if (!property || problem) throw new ApplicationError(problem ?? 'No Search Console property covers this website.', 422, 'SEO_GSC_CONFIGURATION');
  return inspectSearchConsoleUrl(ctx, { propertyUrl: property.propertyUrl, inspectionUrl: page.toString() });
}
