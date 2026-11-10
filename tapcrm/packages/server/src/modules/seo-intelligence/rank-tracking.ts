import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { getSerpAllowance } from './serp-allowance.js';
import { createSerpApiProvider } from './providers/serpapi.js';
import { harvestKeywordsFromGsc } from './gsc-keywords.js';

/** Position checks per site per run; every check still spends from the monthly allowance. */
export const RANK_BATCH_LIMIT = 25;

const COUNTRY_CODES: Record<string, string> = { ind: 'in', usa: 'us', gbr: 'uk', can: 'ca', aus: 'au', are: 'ae', sgp: 'sg', deu: 'de', fra: 'fr', nld: 'nl', nzl: 'nz', zaf: 'za', sau: 'sa', qat: 'qa', pak: 'pk', bgd: 'bd', npl: 'np', lka: 'lk', mys: 'my', idn: 'id', phl: 'ph', jpn: 'jp', kor: 'kr', chn: 'cn', esp: 'es', ita: 'it', bra: 'br', mex: 'mx', irl: 'ie', swe: 'se', che: 'ch', pol: 'pl' };
export function serpCountry(country: string): string | null {
  const key = country.toLowerCase();
  return COUNTRY_CODES[key] ?? (/^[a-z]{2}$/.test(key) ? key : null);
}

export async function getRankTrackingStatus(ctx: RequestContext, siteId: string) {
  const allowance = await getSerpAllowance(ctx, siteId);
  const keywords = await db.one<{ count: number }>(ctx, sql`
    SELECT count(*)::integer AS count FROM seo_keywords
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId} AND tracked = true
  `);
  return { provider: 'serpapi', configured: Boolean(process.env['SERPAPI_API_KEY']),
    ...allowance, trackedKeywords: keywords.count };
}

/** Both scheduled and manual checks share the same allowance and cadence. */
export async function checkSiteRanks(ctx: RequestContext, siteId: string): Promise<number> {
  const status = await getRankTrackingStatus(ctx, siteId);
  if (!status.configured || status.remaining === 0) return 0;
  await harvestKeywordsFromGsc(ctx, siteId);
  const keywords = await db.query<{ id: string; keyword: string; country: string; device: 'desktop' | 'mobile'; language: string; displayUrl: string }>(ctx, sql`
    SELECT k.id, k.keyword, k.country, k.device, k.language, s.display_url
    FROM seo_keywords k JOIN seo_sites s ON s.id = k.site_id AND s.organization_id = k.organization_id
    WHERE k.organization_id = ${ctx.organizationId} AND k.site_id = ${siteId} AND s.active = true
      AND k.tracked = true AND k.check_cadence IN ('daily', 'weekly', 'monthly')
      AND NOT EXISTS (SELECT 1 FROM seo_serp_observations o WHERE o.keyword_id = k.id
        AND o.organization_id = ${ctx.organizationId} AND o.observed_at > now() -
          CASE k.check_cadence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '30 days' END)
    ORDER BY k.created_at, k.keyword, k.country, k.device LIMIT ${RANK_BATCH_LIMIT}
  `);
  let observed = 0;
  for (const keyword of keywords) {
    const country = serpCountry(keyword.country);
    if (!country) continue;
    const provider = createSerpApiProvider({ ctx, apiKey: process.env['SERPAPI_API_KEY'] ?? '', siteId, keywordId: keyword.id, scanRunId: null });
    try {
      const result = await provider.observe({ query: keyword.keyword, targetDomain: new URL(keyword.displayUrl).hostname,
        market: country, language: keyword.language, device: keyword.device, depth: 10 });
      const state = result.state !== 'ok' ? 'unavailable' : result.data?.organicRank != null ? 'observed' : 'not_observed';
      await db.query(ctx, sql`
        INSERT INTO seo_serp_observations
          (id, organization_id, site_id, keyword_id, engine, country, device, provider,
           organic_rank, observed_url, result_type, snapshot_complete, state)
        VALUES (${randomUUID()}, ${ctx.organizationId}, ${siteId}, ${keyword.id}, 'google',
          ${country}, ${keyword.device}, 'serpapi', ${result.data?.organicRank ?? null},
          ${result.data?.observedUrl ?? null}, ${result.data?.resultType ?? null},
          ${result.data?.snapshotComplete ?? false}, ${state})
      `);
      observed++;
      if (result.state !== 'ok') break; // Avoid spending the batch on a failing provider.
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'SEO_SERP_LIMIT') break;
      if (error instanceof ApplicationError && error.code === 'SEO_SERP_ALREADY_CHECKED') continue;
      throw error;
    }
  }
  return observed;
}
