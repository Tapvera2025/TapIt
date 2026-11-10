import { randomUUID } from 'node:crypto';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';

export function normalizeKeywordDevice(raw: string | null): 'desktop' | 'mobile' | null {
  if (!raw) return 'desktop';
  const lower = raw.toLowerCase();
  if (lower === 'mobile') return 'mobile';
  if (lower === 'desktop') return 'desktop';
  // tablet and unknown aren't trackable with the current seo_keywords.device CHECK
  return null;
}

export async function harvestKeywordsFromGsc(
  ctx: RequestContext,
  siteId: string,
): Promise<number> {
  const existingSet = await db.maybeOne<{ id: string }>(ctx, sql`
    SELECT id FROM seo_keyword_sets
    WHERE organization_id = ${ctx.organizationId}
      AND site_id = ${siteId}
      AND name = 'GSC Harvest'
    LIMIT 1
  `);
  const setId = existingSet
    ? existingSet.id
    : (await db.one<{ id: string }>(ctx, sql`
        INSERT INTO seo_keyword_sets (id, site_id, organization_id, name, description)
        VALUES (${randomUUID()}, ${siteId}, ${ctx.organizationId}, 'GSC Harvest',
                'Keywords automatically harvested from Google Search Console query data')
        RETURNING id
      `)).id;

  const queries = await db.query<{
    query: string;
    country: string | null;
    device: string | null;
    totalClicks: string;
    totalImpressions: string;
  }>(ctx, sql`
    SELECT query, country, device,
           SUM(clicks)::text AS total_clicks,
           SUM(impressions)::text AS total_impressions
    FROM seo_gsc_metrics
    WHERE organization_id = ${ctx.organizationId}
      AND site_id = ${siteId}
      AND query IS NOT NULL AND query <> ''
      AND date >= (current_date - interval '28 days')::date
    GROUP BY query, country, device
    HAVING SUM(impressions) >= 10
    ORDER BY SUM(clicks) DESC
    LIMIT 500
  `);

  const today = new Date().toISOString().slice(0, 10);
  let inserted = 0;

  for (const row of queries) {
    const device = normalizeKeywordDevice(row.device);
    if (!device) continue;
    const country = row.country ?? 'global';
    const rows = await db.query<{ id: string }>(ctx, sql`
      INSERT INTO seo_keywords
        (id, set_id, site_id, organization_id, keyword, country, device,
         language, tracked, check_cadence, notes)
      VALUES
        (${randomUUID()}, ${setId}, ${siteId}, ${ctx.organizationId},
         ${row.query}, ${country}, ${device}, 'en', false, 'weekly',
         ${`Harvested from GSC on ${today} (clicks=${row.totalClicks}, impressions=${row.totalImpressions})`})
      ON CONFLICT (site_id, keyword, country, device) DO NOTHING
      RETURNING id
    `);
    inserted += rows.length;
  }

  // Harvested terms are suggestions. Only when a site tracks nothing yet are
  // its strongest few tracked, so position checks have a sensible start; each
  // check spends from the site's search allowance.
  await db.query(ctx, sql`
    UPDATE seo_keywords SET tracked = true
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND id IN (
      SELECT k.id FROM seo_keywords k
      JOIN unnest(${queries.map((q) => q.query)}::text[]) WITH ORDINALITY AS q(query, rank) ON q.query = k.keyword
      WHERE k.organization_id = ${ctx.organizationId} AND k.site_id = ${siteId} AND k.set_id = ${setId}
      ORDER BY q.rank LIMIT ${AUTO_TRACKED_TERMS}
    )
    AND NOT EXISTS (
      SELECT 1 FROM seo_keywords t
      WHERE t.organization_id = ${ctx.organizationId} AND t.site_id = ${siteId} AND t.tracked = true
    )
  `);

  return inserted;
}

/** How many harvested terms are tracked automatically for a site that tracks none. */
export const AUTO_TRACKED_TERMS = 10;
