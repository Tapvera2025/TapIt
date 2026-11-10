import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Monthly request allowances for the paid data sources, per website.
 *
 * Google searches (SerpApi) pay for position checks and for Google AI Overview
 * checks, and share one allowance (seo_serp_allowance). Perplexity answers and
 * Moz backlink lookups each have their own (seo_provider_allowance). Every
 * allowance starts at 0, so nothing is spent until an administrator approves
 * a monthly number. Attempts count whether or not the provider answered.
 */

export type PaidProvider = 'moz' | 'perplexity';

export interface AllowanceStatus {
  configured: boolean;
  monthlyLimit: number;
  used: number;
  remaining: number;
}

export interface SiteAllowances {
  serpSearches: AllowanceStatus;
  perplexity: AllowanceStatus;
  moz: AllowanceStatus;
}

const MONTH_START = sql`date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

export function providerConfigured(provider: PaidProvider | 'serpapi'): boolean {
  if (provider === 'serpapi') return Boolean(process.env['SERPAPI_API_KEY']);
  if (provider === 'perplexity') return Boolean(process.env['PERPLEXITY_API_KEY']);
  return Boolean(process.env['MOZ_ACCESS_ID'] && process.env['MOZ_SECRET_KEY']);
}

function status(configured: boolean, monthlyLimit: number, used: number): AllowanceStatus {
  return { configured, monthlyLimit, used, remaining: Math.max(0, monthlyLimit - used) };
}

export async function getSiteAllowances(ctx: RequestContext, siteId: string): Promise<SiteAllowances> {
  const row = await db.one<{
    serpLimit: number; serpUsed: number; perplexityLimit: number; perplexityUsed: number; mozLimit: number; mozUsed: number;
  }>(ctx, sql`
    SELECT
      COALESCE((SELECT monthly_search_limit FROM seo_serp_allowance
                WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}), 0) AS serp_limit,
      (SELECT count(*)::integer FROM seo_serp_search_request
       WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND requested_at >= ${MONTH_START}) AS serp_used,
      COALESCE((SELECT monthly_limit FROM seo_provider_allowance
                WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = 'perplexity'), 0) AS perplexity_limit,
      (SELECT count(*)::integer FROM seo_provider_call
       WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = 'perplexity'
         AND requested_at >= ${MONTH_START}) AS perplexity_used,
      COALESCE((SELECT monthly_limit FROM seo_provider_allowance
                WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = 'moz'), 0) AS moz_limit,
      (SELECT count(*)::integer FROM seo_provider_call
       WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = 'moz'
         AND requested_at >= ${MONTH_START}) AS moz_used
  `);
  return {
    serpSearches: status(providerConfigured('serpapi'), row.serpLimit, row.serpUsed),
    perplexity: status(providerConfigured('perplexity'), row.perplexityLimit, row.perplexityUsed),
    moz: status(providerConfigured('moz'), row.mozLimit, row.mozUsed),
  };
}

export async function setSiteAllowances(
  ctx: RequestContext,
  siteId: string,
  patch: { serpSearches?: number; perplexity?: number; moz?: number },
): Promise<SiteAllowances> {
  await db.transaction(ctx, async (tx) => {
    await tx.one(sql`SELECT id FROM seo_sites WHERE organization_id = ${ctx.organizationId} AND id = ${siteId} FOR UPDATE`);
    if (patch.serpSearches !== undefined) {
      await tx.query(sql`
        INSERT INTO seo_serp_allowance (organization_id, site_id, monthly_search_limit)
        VALUES (${ctx.organizationId}, ${siteId}, ${patch.serpSearches})
        ON CONFLICT (organization_id, site_id) DO UPDATE SET monthly_search_limit = EXCLUDED.monthly_search_limit
      `);
    }
    for (const provider of ['perplexity', 'moz'] as const) {
      const limit = patch[provider];
      if (limit === undefined) continue;
      await tx.query(sql`
        INSERT INTO seo_provider_allowance (organization_id, site_id, provider, monthly_limit)
        VALUES (${ctx.organizationId}, ${siteId}, ${provider}, ${limit})
        ON CONFLICT (organization_id, site_id, provider) DO UPDATE
          SET monthly_limit = EXCLUDED.monthly_limit, updated_at = now()
      `);
    }
  });
  return getSiteAllowances(ctx, siteId);
}

/** Reserves one paid request. False when the allowance is unset or used up. */
export async function reserveProviderCall(
  ctx: RequestContext,
  siteId: string,
  provider: PaidProvider,
  purpose: string,
): Promise<boolean> {
  return db.transaction(ctx, async (tx) => {
    const allowance = await tx.maybeOne<{ monthlyLimit: number }>(sql`
      SELECT monthly_limit FROM seo_provider_allowance
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = ${provider}
      FOR UPDATE
    `);
    if (!allowance || allowance.monthlyLimit <= 0) return false;
    const used = await tx.one<{ n: number }>(sql`
      SELECT count(*)::integer AS n FROM seo_provider_call
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = ${provider}
        AND requested_at >= ${MONTH_START}
    `);
    if (used.n >= allowance.monthlyLimit) return false;
    await tx.query(sql`
      INSERT INTO seo_provider_call (organization_id, site_id, provider, purpose)
      VALUES (${ctx.organizationId}, ${siteId}, ${provider}, ${purpose})
    `);
    return true;
  });
}

/** Reserves one Google search for an AI Overview check, from the same allowance as position checks. */
export async function reserveAiOverviewSearch(ctx: RequestContext, siteId: string): Promise<boolean> {
  return db.transaction(ctx, async (tx) => {
    const allowance = await tx.maybeOne<{ monthlySearchLimit: number }>(sql`
      SELECT monthly_search_limit FROM seo_serp_allowance
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} FOR UPDATE
    `);
    if (!allowance || allowance.monthlySearchLimit <= 0) return false;
    const used = await tx.one<{ n: number }>(sql`
      SELECT count(*)::integer AS n FROM seo_serp_search_request
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND requested_at >= ${MONTH_START}
    `);
    if (used.n >= allowance.monthlySearchLimit) return false;
    await tx.query(sql`
      INSERT INTO seo_serp_search_request (organization_id, site_id, keyword_id, purpose)
      VALUES (${ctx.organizationId}, ${siteId}, NULL, 'ai_overview')
    `);
    return true;
  });
}

/** When this site last spent a request with `provider`, if ever. */
export async function lastProviderCall(ctx: RequestContext, siteId: string, provider: PaidProvider): Promise<Date | null> {
  const row = await db.maybeOne<{ at: Date | null }>(ctx, sql`
    SELECT max(requested_at) AS at FROM seo_provider_call
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND provider = ${provider}
  `);
  return row?.at ?? null;
}
