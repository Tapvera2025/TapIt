import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { cruxFetch } from './providers/crux.js';
import { pagespeedFetch } from './providers/pagespeed.js';

type State = 'running' | 'ready' | 'no_data' | 'not_configured' | 'error';
export async function setPerformanceStatus(ctx: RequestContext, siteId: string, provider: 'crux' | 'pagespeed', state: State, message: string | null = null) {
  await db.query(ctx, sql`
    INSERT INTO seo_performance_status (organization_id, site_id, provider, state, message)
    VALUES (${ctx.organizationId}, ${siteId}, ${provider}, ${state}, ${message})
    ON CONFLICT (organization_id, site_id, provider) DO UPDATE
      SET state = EXCLUDED.state, message = EXCLUDED.message, updated_at = now()
  `);
}

export async function getPerformanceStatus(ctx: RequestContext, siteId: string) {
  const rows = await db.query<{ provider: string; state: State; message: string | null; updatedAt: Date }>(ctx, sql`
    SELECT provider, state, message, updated_at FROM seo_performance_status
    WHERE organization_id = ${ctx.organizationId} AND site_id = ${siteId}
  `);
  return (['crux', 'pagespeed'] as const).map(provider => {
    const configured = provider === 'crux' ? Boolean(process.env['CRUX_API_KEY'] || process.env['PAGESPEED_API_KEY']) : Boolean(process.env['PAGESPEED_API_KEY']);
    return { provider, configured, state: configured ? 'not_run' : 'not_configured', message: null, updatedAt: null, ...rows.find(row => row.provider === provider) };
  });
}

export async function refreshCrux(ctx: RequestContext, siteId: string, url: string): Promise<number> {
  await setPerformanceStatus(ctx, siteId, 'crux', 'running');
  try {
    const result = await cruxFetch(url, 'PHONE');
    if (result.state !== 'ok') {
      await setPerformanceStatus(ctx, siteId, 'crux', result.state === 'not_configured' ? 'not_configured' : 'error', result.message ?? 'The CrUX request failed.');
      return 0;
    }
    if (!result.data?.dataAvailable) {
      await setPerformanceStatus(ctx, siteId, 'crux', 'no_data', result.message ?? 'Google has no eligible real-user data for this origin and device.');
      return 0;
    }
    const m = result.data;
    await db.query(ctx, sql`
      INSERT INTO seo_cwv_observations (site_id, organization_id, url, device,
        lcp_p75, inp_p75, cls_p75, lcp_rating, inp_rating, cls_rating,
        form_factor, data_source, collection_start, collection_end)
      VALUES (${siteId}, ${ctx.organizationId}, null, 'phone',
        ${m.lcp ? Math.round(m.lcp.p75) : null}, ${m.inp ? Math.round(m.inp.p75) : null}, ${m.cls?.p75 ?? null},
        ${m.lcp?.rating ?? null}, ${m.inp?.rating ?? null}, ${m.cls?.rating ?? null}, 'PHONE', 'crux_api',
        ${m.collectionStart ?? null}::date, ${m.collectionEnd ?? null}::date)
    `);
    await setPerformanceStatus(ctx, siteId, 'crux', 'ready');
    return 1;
  } catch (error) {
    await setPerformanceStatus(ctx, siteId, 'crux', 'error', 'The CrUX result could not be saved. Retry the refresh.');
    throw error;
  }
}

export async function refreshLighthouse(ctx: RequestContext, siteId: string, url: string): Promise<number> {
  await setPerformanceStatus(ctx, siteId, 'pagespeed', 'running');
  try {
    const result = await pagespeedFetch(url, 'mobile');
    if (result.state !== 'ok' || !result.data) {
      await setPerformanceStatus(ctx, siteId, 'pagespeed', 'error', result.message ?? 'The PageSpeed audit failed.');
      return 0;
    }
    const m = result.data;
    await db.query(ctx, sql`
      INSERT INTO seo_cwv_observations (site_id, organization_id, url, device, perf_score,
        lab_lcp_ms, lab_cls, lab_tbt_ms, form_factor, data_source)
      VALUES (${siteId}, ${ctx.organizationId}, ${url}, 'mobile', ${m.performanceScore},
        ${m.lcp === null ? null : Math.round(m.lcp)}, ${m.cls}, ${m.tbt === null ? null : Math.round(m.tbt)}, 'PHONE', 'lighthouse_lab')
    `);
    await setPerformanceStatus(ctx, siteId, 'pagespeed', 'ready');
    return 1;
  } catch (error) {
    await setPerformanceStatus(ctx, siteId, 'pagespeed', 'error', 'The PageSpeed result could not be saved. Retry the refresh.');
    throw error;
  }
}
