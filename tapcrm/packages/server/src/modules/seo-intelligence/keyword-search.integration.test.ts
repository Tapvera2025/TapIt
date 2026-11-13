/**
 * Keyword search and Search Console in the SEO dashboard, against PostgreSQL.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… \
 *     npx vitest run packages/server/src/modules/seo-intelligence/keyword-search.integration.test.ts
 *
 * Guards: a website scan spends the website's own allowance (and nothing when
 * it is 0), keeps what it found, never looks past the depth asked for; the
 * Search Console report reads the property the website's address resolves to,
 * narrowed to the website, and says why when there is none.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as SocialFacade from '../social/facade.js';

const facade = vi.hoisted(() => ({
  connected: true,
  properties: [] as Array<Record<string, unknown>>,
  performance: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock('../social/facade.js', async (original) => ({
  ...(await original<typeof SocialFacade>()),
  searchConsoleConnected: async () => facade.connected,
  listSearchConsoleProperties: async () => ({ properties: facade.properties, problem: null }),
  searchConsolePerformance: facade.performance,
  inspectSearchConsoleUrl: facade.inspect,
}));

import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { createTestContext } from '../../platform/test-helpers.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { listRankScans, scanSiteRank } from './rank-scan.js';
import { getSiteSearchConsoleReport, inspectSiteUrl } from './search-console.js';
import { getSerpAllowance } from './serp-allowance.js';
import { registerSite } from './service.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

function serp(items: Array<{ position: number; link: string; title?: string }>, next?: number): Response {
  return new Response(
    JSON.stringify({
      organic_results: items,
      ...(next !== undefined ? { serpapi_pagination: { next: `https://serpapi.com/search.json?start=${next}` } } : {}),
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe.skipIf(!enabled)('SEO keyword search (PostgreSQL)', () => {
  let orgId = '';
  let siteId = '';
  let clientId = '';
  let ctx: RequestContext;
  const admin = <T>(fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', 'keyword-search fixture', fragment);

  beforeAll(async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'test-key');
    orgId = (await admin<{ id: string }>(sql`INSERT INTO organization (code, name)
      VALUES ('KS' || replace(gen_random_uuid()::text, '-', ''), 'Keyword Search Co') RETURNING id`))[0]!.id;
    const dept = (await admin<{ id: string }>(sql`INSERT INTO department (organization_id, code, name, kind)
      VALUES (${orgId}, 'SEO', 'SEO', 'support') RETURNING id`))[0]!.id;
    const pos = (await admin<{ id: string }>(sql`INSERT INTO position (organization_id, department_id, code, name, organizational_level)
      VALUES (${orgId}, ${dept}, 'SEO', 'SEO', 10) RETURNING id`))[0]!.id;
    const userId = (await admin<{ id: string }>(sql`INSERT INTO app_user
      (organization_id, employee_id, email, full_name, account_type, department_id, position_id)
      VALUES (${orgId}, 'KS-1', ${`ks-${randomUUID()}@test.invalid`}, 'Keyword Tester', 'employee', ${dept}, ${pos}) RETURNING id`))[0]!.id;
    clientId = (await admin<{ id: string }>(sql`INSERT INTO client (organization_id, client_name, business_name, email, region, currency, timezone, created_by)
      VALUES (${orgId}, 'Acme', 'Acme Dental Clinic', ${`acme-${randomUUID()}@test.invalid`}, 'in', 'INR', 'Asia/Kolkata', ${userId}) RETURNING id`))[0]!.id;
    ctx = createTestContext(orgId, userId);
    const site = await registerSite(ctx, {
      clientId,
      displayUrl: 'https://www.acmedental.in',
      timezone: 'Asia/Kolkata',
      locale: 'en',
      businessIntents: [],
      stackNotes: null,
    });
    siteId = (site as unknown as { id: string }).id;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    facade.performance.mockReset();
    facade.inspect.mockReset();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closePools();
  });

  it('refuses to scan, and spends nothing, while the website has no allowance', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      scanSiteRank(ctx, siteId, { keyword: 'dentist', searchEngine: 'google', category: 'seo', country: 'india', device: 'desktop', depth: 30 }),
    ).rejects.toMatchObject({ code: 'SEO_SERP_LIMIT' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await listRankScans(ctx, siteId)).toEqual([]);
  });

  it('finds the website, keeps the scan and spends one search from its allowance', async () => {
    await admin(sql`INSERT INTO seo_serp_allowance (organization_id, site_id, monthly_search_limit) VALUES (${orgId}, ${siteId}, 5)`);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      expect(params.get('location')).toBe('Mumbai, India');
      expect(params.get('gl')).toBe('in');
      expect(params.get('device')).toBe('mobile');
      return serp([
        { position: 1, link: 'https://competitor.in/', title: 'Competitor' },
        { position: 2, link: 'https://acmedental.in/implants', title: 'Dental implants — Acme' },
      ]);
    }));
    const { scan, allowance } = await scanSiteRank(ctx, siteId, {
      keyword: 'dental implants', searchEngine: 'google', category: 'seo', country: 'India', city: 'Mumbai', device: 'mobile', depth: 30,
    });
    expect(scan).toMatchObject({
      keyword: 'dental implants', engine: 'google', status: 'found', position: 2,
      rankingUrl: 'https://acmedental.in/implants', searchLocation: 'Mumbai, India', device: 'mobile',
      resultsChecked: 2, pagesRequested: 1, requestedByName: 'Keyword Tester',
    });
    expect(scan.topResults).toHaveLength(2);
    expect(allowance).toMatchObject({ monthlyLimit: 5, used: 1, remaining: 4 });
    const requests = await admin<{ purpose: string; keywordId: string | null }>(
      sql`SELECT purpose, keyword_id FROM seo_serp_search_request WHERE site_id = ${siteId}`,
    );
    expect(requests).toEqual([{ purpose: 'scan', keywordId: null }]);
  });

  it('looks no deeper than asked and records a not-found', async () => {
    const starts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const start = Number(new URL(url).searchParams.get('start') ?? '0');
      starts.push(String(start));
      return serp(Array.from({ length: 10 }, (_, i) => ({ position: i + 1, link: `https://other${i}.in/` })), start + 10);
    }));
    const { scan, allowance } = await scanSiteRank(ctx, siteId, {
      keyword: 'dentist', searchEngine: 'google', category: 'seo', country: 'in', device: 'desktop', depth: 20,
    });
    expect(scan).toMatchObject({ status: 'not-found', position: null, resultsChecked: 20, pagesRequested: 2 });
    expect(scan.message).toContain('first 20 results');
    expect(starts).toEqual(['0', '10']);
    expect(allowance.used).toBe(3);
  });

  it('matches a map-pack listing by the client’s business name', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('engine')).toBe('google_local');
      return new Response(JSON.stringify({ local_results: [
        { position: 1, title: 'Smile Studio' },
        { position: 2, title: 'Acme Dental Clinic' },
      ] }), { status: 200 });
    }));
    const { scan } = await scanSiteRank(ctx, siteId, {
      keyword: 'dentist near me', searchEngine: 'google', category: 'gmb', country: 'india', city: 'Pune', device: 'desktop', depth: 20,
    });
    expect(scan).toMatchObject({ engine: 'google_local', status: 'found', position: 2, searchLocation: 'Pune, India' });
  });

  it('stops part-way when the allowance runs out, and keeps the failed scan', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const start = Number(new URL(url).searchParams.get('start') ?? '0');
      return serp(Array.from({ length: 10 }, (_, i) => ({ position: i + 1, link: `https://x${i}.in/` })), start + 10);
    }));
    const { scan, allowance } = await scanSiteRank(ctx, siteId, {
      keyword: 'teeth whitening', searchEngine: 'google', category: 'seo', country: 'india', device: 'desktop', depth: 100,
    });
    expect(scan.status).toBe('failed');
    expect(scan.message).toContain('allowance ran out');
    expect(allowance.remaining).toBe(0);
    const scans = await listRankScans(ctx, siteId);
    expect(scans.map((item) => item.status)).toEqual(['failed', 'found', 'not-found', 'found']);
    expect((await getSerpAllowance(ctx, siteId)).used).toBe(5);
  });

  it('refuses an unknown country before spending anything', async () => {
    await admin(sql`UPDATE seo_serp_allowance SET monthly_search_limit = 50 WHERE site_id = ${siteId}`);
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      scanSiteRank(ctx, siteId, { keyword: 'x', searchEngine: 'google', category: 'seo', country: 'Narnia', device: 'desktop', depth: 10 }),
    ).rejects.toMatchObject({ code: 'SEO_SITE_VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says why there is no Search Console report when no property covers the website', async () => {
    facade.properties = [{ propertyUrl: 'sc-domain:someoneelse.in', permissionLevel: 'siteOwner', clientId: null, clientName: null, source: 'company_login', account: 'a@x.test', status: 'connected' }];
    const report = await getSiteSearchConsoleReport(ctx, siteId, { from: '2026-10-01', to: '2026-10-28' });
    expect(report.property).toBeNull();
    expect(report.problem).toMatch(/Search Console property covering this website/);
    expect(facade.performance).not.toHaveBeenCalled();
  });

  it('reads the website’s own property, narrowed to its pages, preferring its client’s', async () => {
    facade.properties = [
      { propertyUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner', clientId: null, clientName: null, source: 'company_login', account: 'agency@x.test', status: 'connected' },
      { propertyUrl: 'https://www.acmedental.in/', permissionLevel: 'siteFullUser', clientId, clientName: 'Acme', source: 'company_login', account: 'acme@x.test', status: 'connected' },
    ];
    facade.performance.mockResolvedValue({ propertyUrl: 'https://www.acmedental.in/', totals: null });
    const report = await getSiteSearchConsoleReport(ctx, siteId, { from: '2026-10-01', to: '2026-10-28' });
    expect(report.property).toMatchObject({ propertyUrl: 'https://www.acmedental.in/', account: 'acme@x.test' });
    expect(facade.performance).toHaveBeenCalledWith(ctx, {
      propertyUrl: 'https://www.acmedental.in/', from: '2026-10-01', to: '2026-10-28', pageFilter: null,
    });

    facade.properties = [facade.properties[0]!];
    await getSiteSearchConsoleReport(ctx, siteId, { from: '2026-10-01', to: '2026-10-28' });
    expect(facade.performance).toHaveBeenLastCalledWith(ctx, expect.objectContaining({
      propertyUrl: 'sc-domain:acmedental.in', pageFilter: '^https?://(www\\.)?acmedental\\.in/',
    }));
  });

  it('says a login needs reconnecting instead of failing', async () => {
    facade.properties = [{ propertyUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner', clientId: null, clientName: null, source: 'company_login', account: null, status: 'reconnect_required' }];
    const report = await getSiteSearchConsoleReport(ctx, siteId, { from: '2026-10-01', to: '2026-10-28' });
    expect(report.problem).toMatch(/reconnected/);
    expect(report.performance).toBeNull();
  });

  it('inspects only pages on this website', async () => {
    facade.properties = [{ propertyUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner', clientId: null, clientName: null, source: 'company_login', account: null, status: 'connected' }];
    facade.inspect.mockResolvedValue({ inspectionUrl: 'https://acmedental.in/about' });
    await expect(inspectSiteUrl(ctx, siteId, { inspectionUrl: 'https://evil.test/' })).rejects.toMatchObject({ code: 'SEO_GSC_URL_OUTSIDE_SITE' });
    await inspectSiteUrl(ctx, siteId, { inspectionUrl: 'https://acmedental.in/about' });
    expect(facade.inspect).toHaveBeenCalledWith(ctx, { propertyUrl: 'sc-domain:acmedental.in', inspectionUrl: 'https://acmedental.in/about' });
  });
});
