import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequestContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  checkSeoKeywordLive,
  getProjectLiveSettings,
  getProjectRankings,
  setProjectLiveSettings,
} from './service.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

describe.skipIf(!enabled)('Project live rank checks (SerpApi, PostgreSQL)', () => {
  const org = randomUUID();
  const dept = randomUUID();
  const position = randomUUID();
  const user = randomUUID();
  const client = randomUUID();
  const project = randomUUID();
  const keyword = randomUUID();
  const admin = <T>(fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', 'live-rank fixture', fragment);
  const ctx = () =>
    createRequestContext({
      organizationId: org,
      principal: {
        id: user,
        organizationId: org,
        accountType: 'employee',
        sessionVersion: 0,
        positionId: position,
        departmentId: dept,
        teamId: null,
        reportsTo: null,
        organizationalLevel: 1,
      },
      requestId: randomUUID(),
    });
  const serp = (items: Array<{ position: number; link: string }>) =>
    new Response(JSON.stringify({ organic_results: items }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  beforeAll(async () => {
    if (!new URL(process.env['MIGRATION_DATABASE_URL'] ?? '').pathname.includes('test'))
      throw new Error('Refusing live-rank fixtures outside a test database');
    vi.stubEnv('SERPAPI_API_KEY', 'test-key');
    await admin(sql`INSERT INTO organization (id, code, name) VALUES (${org}, ${`LR${org.slice(0, 6)}`}, 'Live Rank Co')`);
    await admin(sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${dept}, ${org}, 'D1', 'Dept', 'support')`);
    await admin(sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${position}, ${org}, ${dept}, 'PM', 'PM', 20)`);
    await admin(sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name, status, employee_id, department_id, position_id)
      VALUES (${user}, ${org}, 'employee', ${`${org}@lr.invalid`}, 'PM', 'active', 'LR-1', ${dept}, ${position})`);
    await admin(sql`INSERT INTO client (id, organization_id, client_name, business_name, email, region, currency, timezone, created_by)
      VALUES (${client}, ${org}, 'Acme', 'Acme Dental', ${`acme-${org.slice(0, 6)}@lr.invalid`}, 'in', 'INR', 'Asia/Kolkata', ${user})`);
    await admin(sql`INSERT INTO project (id, organization_id, client_id, name, priority, work_status, start_date, currency, created_by)
      VALUES (${project}, ${org}, ${client}, 'SEO project', 'high', 'ongoing', current_date, 'INR', ${user})`);
    await admin(sql`INSERT INTO project_seo_keyword (id, organization_id, project_id, keyword, previous_rank, current_rank, target_url, country, city, device, category, created_by)
      VALUES (${keyword}, ${org}, ${project}, 'best dentist mumbai', NULL, NULL, 'https://acmedental.in/', 'india', NULL, 'desktop', 'seo', ${user})`);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closePools();
  });

  it('starts with live checks disabled until an allowance is set', async () => {
    const settings = await getProjectLiveSettings(ctx(), project);
    expect(settings).toMatchObject({ monthlyLimit: 0, used: 0, remaining: 0, configured: true });
  });

  it('refuses a live check while the allowance is zero, and falls through to no Search Console', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serp([])));
    const { outcome } = await checkSeoKeywordLive(ctx(), project, keyword);
    expect(outcome).toMatchObject({ status: 'failed', usedFallback: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds the site live, records the position and spends one search', async () => {
    await setProjectLiveSettings(ctx(), project, { websiteUrl: 'https://acmedental.in', monthlyLimit: 50 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        serp([
          { position: 1, link: 'https://competitor.in/' },
          { position: 2, link: 'https://www.acmedental.in/book' },
        ]),
      ),
    );
    const { outcome, keyword: refreshed } = await checkSeoKeywordLive(ctx(), project, keyword);
    expect(outcome).toMatchObject({ source: 'live', status: 'found', position: 2, url: 'https://www.acmedental.in/book' });
    expect(refreshed?.currentRank).toBe(2);

    const history = await admin<{ source: string; observedRank: number | null; rankingUrl: string | null }>(
      sql`SELECT source, observed_rank AS "observedRank", ranking_url AS "rankingUrl" FROM project_seo_rank_history WHERE keyword_id = ${keyword} AND source = 'live'`,
    );
    expect(history).toEqual([{ source: 'live', observedRank: 2, rankingUrl: 'https://www.acmedental.in/book' }]);
    const settings = await getProjectLiveSettings(ctx(), project);
    expect(settings.used).toBe(1);
  });

  it('records a not-found without blanking the last known rank', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => serp([{ position: 1, link: 'https://competitor.in/' }])));
    const { outcome, keyword: refreshed } = await checkSeoKeywordLive(ctx(), project, keyword);
    expect(outcome).toMatchObject({ status: 'not-found', resultsChecked: 1 });
    // The previous live rank stands; a sparse results page does not erase it.
    expect(refreshed?.currentRank).toBe(2);
    const latest = await admin<{ outcome: string }>(
      sql`SELECT last_live_outcome AS outcome FROM project_seo_keyword WHERE id = ${keyword}`,
    );
    expect(latest[0]?.outcome).toBe('not-found');
  });

  it('lists every active keyword with its latest live reading, whatever its age', async () => {
    // A keyword untouched for months still belongs on the rankings view.
    await admin(sql`UPDATE project_seo_keyword SET updated_at = now() - interval '200 days' WHERE id = ${keyword}`);
    const rankings = await getProjectRankings(ctx(), project);
    expect(rankings.project).toMatchObject({ id: project, businessName: 'Acme Dental' });
    expect(rankings.keywords).toHaveLength(1);
    expect(rankings.keywords[0]).toMatchObject({ id: keyword, lastLiveOutcome: 'not-found', lastLiveLocation: 'India' });
    expect(rankings.settings).toMatchObject({ effectiveHost: 'acmedental.in', websiteSource: 'project', searchDepth: 30 });
  });

  it('looks only as deep as the project allows, paying per page', async () => {
    await setProjectLiveSettings(ctx(), project, { searchDepth: 20 });
    const before = (await getProjectLiveSettings(ctx(), project)).used;
    const starts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const start = new URL(url).searchParams.get('start') ?? '0';
      starts.push(start);
      return new Response(JSON.stringify({
        organic_results: Array.from({ length: 10 }, (_, i) => ({ position: i + 1, link: `https://other${i}.in/` })),
        serpapi_pagination: { next: `https://serpapi.com/search.json?start=${Number(start) + 10}` },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { outcome } = await checkSeoKeywordLive(ctx(), project, keyword);
    expect(outcome).toMatchObject({ status: 'not-found', resultsChecked: 20, pagesRequested: 2 });
    expect(starts).toEqual(['0', '10']);
    expect((await getProjectLiveSettings(ctx(), project)).used).toBe(before + 2);
  });

  it('falls back to the linked Search Console property for the website', async () => {
    await setProjectLiveSettings(ctx(), project, { websiteUrl: null });
    await admin(sql`INSERT INTO project_seo_search_console (organization_id, project_id, property_url, property_type, created_by)
      VALUES (${org}, ${project}, 'sc-domain:acmedental.in', 'domain', ${user})`);
    const settings = await getProjectLiveSettings(ctx(), project);
    expect(settings).toMatchObject({ websiteUrl: null, effectiveHost: 'acmedental.in', websiteSource: 'search-console' });
  });

  it('matches a local-pack keyword by the client’s business name, not by the keyword', async () => {
    const local = randomUUID();
    await admin(sql`INSERT INTO project_seo_keyword (id, organization_id, project_id, keyword, previous_rank, current_rank, target_url, country, city, device, category, created_by)
      VALUES (${local}, ${org}, ${project}, 'dentist', NULL, NULL, NULL, 'india', 'Mumbai', 'desktop', 'gmb', ${user})`);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('engine')).toBe('google_local');
      expect(new URL(url).searchParams.get('location')).toBe('Mumbai, India');
      return new Response(JSON.stringify({ local_results: [
        { position: 1, title: 'City Dentist' },
        { position: 2, title: 'Acme Dental - Bandra West' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { outcome } = await checkSeoKeywordLive(ctx(), project, local);
    expect(outcome).toMatchObject({ status: 'found', position: 2, engine: 'google_local', location: 'Mumbai, India' });
  });

  it('stops when the monthly allowance is used up', async () => {
    await setProjectLiveSettings(ctx(), project, { monthlyLimit: (await getProjectLiveSettings(ctx(), project)).used });
    vi.stubGlobal('fetch', vi.fn(async () => serp([])));
    const { outcome } = await checkSeoKeywordLive(ctx(), project, keyword);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
