import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function getSerpAllowance(ctx: RequestContext, siteId: string) {
  const row = await db.one<{ monthlyLimit: number; used: number }>(ctx, sql`
    SELECT COALESCE((SELECT monthly_search_limit FROM seo_serp_allowance
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}), 0) AS monthly_limit,
      (SELECT count(*)::integer FROM seo_serp_search_request
       WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
         AND requested_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS used
  `);
  return { ...row, remaining: Math.max(0, row.monthlyLimit - row.used) };
}

/** The allowance row serializes reservations. Failed attempts remain counted. */
export async function reserveSerpSearch(ctx: RequestContext, siteId: string, keywordId: string) {
  const outcome = await db.transaction(ctx, async (tx) => {
    const allowance = await tx.maybeOne<{ monthlySearchLimit: number }>(sql`
      SELECT monthly_search_limit FROM seo_serp_allowance
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} FOR UPDATE
    `);
    if (!allowance || allowance.monthlySearchLimit === 0) return 'limit';
    const used = await tx.one<{ count: number }>(sql`
      SELECT count(*)::integer AS count FROM seo_serp_search_request
      WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
        AND requested_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    `);
    if (used.count >= allowance.monthlySearchLimit) return 'limit';
    const request = await tx.maybeOne<{ id: string }>(sql`
      INSERT INTO seo_serp_search_request (organization_id, site_id, keyword_id)
      SELECT ${ctx.organizationId}, ${siteId}, k.id FROM seo_keywords k
      WHERE k.organization_id = ${ctx.organizationId} AND k.site_id = ${siteId} AND k.id = ${keywordId}
      ON CONFLICT (keyword_id, check_date) DO NOTHING RETURNING id
    `);
    return request ? 'reserved' : 'duplicate';
  });
  if (outcome === 'limit') throw new ApplicationError('The monthly SERP search allowance is exhausted or disabled.', 429, 'SEO_SERP_LIMIT');
  if (outcome === 'duplicate') throw new ApplicationError('This keyword already has a search reserved today.', 409, 'SEO_SERP_ALREADY_CHECKED');
}
