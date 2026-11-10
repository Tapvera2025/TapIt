/**
 * End-to-end checkup against a local fixture website: discover → fetch →
 * evaluate, with the real parser, rules and database, then a second and
 * third checkup to exercise the finding lifecycle.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * The job queue is replaced by an in-memory queue, and the SSRF guard lets
 * loopback through — the fixture site lives on 127.0.0.1.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => [] as Array<{ name: string; key: string; payload: unknown }>);
const definitions = vi.hoisted(() => new Map<string, { handler: (run: unknown) => Promise<unknown> }>());

vi.mock('../../platform/jobs/runner.js', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    defineJob: (definition: { name: string; handler: (run: unknown) => Promise<unknown> }) => {
      definitions.set(definition.name, definition);
      return {
        name: definition.name,
        enqueue: async (input: { key: string; payload: unknown }) => { queue.push({ name: definition.name, ...input }); },
        nextGeneration: async () => ({ kind: 'none' }),
      };
    },
  };
});

vi.mock('./crawler/ssrf-guard.js', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, guardUrl: async (url: string) => { new URL(url); } };
});

const { db, platformDb } = await import('../../platform/dal/db.js');
const { closePools } = await import('../../platform/dal/pool.js');
const { sql } = await import('../../platform/dal/sql.js');
const { createTestContext } = await import('../../platform/test-helpers.js');
const { registerSeoJobs } = await import('./jobs.js');
const { registerSite, triggerScan, updateFindingStatus } = await import('./service.js');
const { provisionSeoRules } = await import('./provisioning.js');
const { updateScanConfig } = await import('./scan-config.js');

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const CRAWL_JOBS = new Set(['seo:crawl_discover', 'seo:crawl_fetch', 'seo:evaluate']);

// ─── Fixture website ─────────────────────────────────────────────────────────

let missingFixed = false;
const words = (n: number, prefix = 'word') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
const pageHtml = (title: string, body: string, head = '') =>
  `<!doctype html><html lang="en"><head><title>${title}</title>
   <meta name="description" content="${title} — a page on the fixture site.">${head}</head>
   <body>${body}</body></html>`;

function fixture(origin: () => string) {
  return createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const html = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    switch (path) {
      case '/robots.txt':
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end(`User-agent: *\nDisallow: /private\nSitemap: ${origin()}/sitemap.xml\n`);
      case '/sitemap.xml':
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><urlset>
          ${['/', '/about', '/new', '/private/x', '/dup-a'].map((p) => `<url><loc>${origin()}${p}</loc><lastmod>2026-10-01</lastmod><priority>5</priority></url>`).join('')}
          <url><loc>${origin()}/bad-date</loc><lastmod>not a date</lastmod></url>
        </urlset>`);
      case '/':
        return html(200, pageHtml('Home', `<h1>Welcome</h1><p>${words(80)}</p>
          <a href="/">Home</a><a href="/about">About</a><a href="/about#team">Team</a>
          <a href="/old">Old</a><a href="/missing">Missing</a><a href="/files/brochure.pdf">Brochure</a>
          <a href="/dup-a">A</a><a href="/dup-b">B</a><a href="/dup-c">C</a><a href="https://example.org/">Elsewhere</a>`,
          `<link rel="canonical" href="/">`));
      case '/about':
        return html(200, `<!doctype html><html lang="en"><head><title>About us</title>
          <meta name="description" content="We're the fixture's about page, isn't it nice?"></head>
          <body><h1>About</h1><h1>Team</h1><p>${words(80)}</p><a href="/">Home</a></body></html>`);
      case '/old':
        res.writeHead(301, { location: '/new' });
        return res.end();
      case '/new':
        return html(200, pageHtml('New page', `<h1>New</h1><p>${words(80, 'new')}</p><a href="/">Home</a>`));
      case '/missing':
        return missingFixed
          ? html(200, pageHtml('Found again', `<h1>Back</h1><p>${words(80, 'back')}</p>`))
          : html(404, '<html><body>Not found</body></html>');
      case '/files/brochure.pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end('%PDF-1.4 fake');
      case '/dup-a':
      case '/dup-b':
        return html(200, pageHtml('Duplicate', `<h1>Dup</h1><p>${words(80, 'dup')}</p>`));
      case '/dup-c':
        return html(200, pageHtml('Duplicate', `<h1>Dup</h1><p>${words(80, 'dup')}</p>`, `<link rel="canonical" href="${origin()}/dup-a">`));
      default:
        return html(404, '<html><body>Not found</body></html>');
    }
  });
}

// ─── Harness ─────────────────────────────────────────────────────────────────

async function drain(ctx: ReturnType<typeof createTestContext>): Promise<void> {
  for (let guard = 0; queue.length > 0 && guard < 200; guard++) {
    const job = queue.shift()!;
    if (!CRAWL_JOBS.has(job.name)) continue; // CrUX / Lighthouse need provider keys
    await definitions.get(job.name)!.handler({ ctx, key: job.key, payload: job.payload, attempt: 1, clock: { now: () => new Date() } });
  }
}

async function setup(siteUrl: string) {
  const orgId = (await platformDb.query<{ id: string }>('seed', 'org', sql`
    INSERT INTO organization (code, name) VALUES ('SC' || replace(gen_random_uuid()::text, '-', ''), 'Crawl test') RETURNING id`))[0]!.id;
  const departmentId = (await platformDb.query<{ id: string }>('seed', 'dept', sql`
    INSERT INTO department (organization_id, code, name, kind) VALUES (${orgId}, 'SEO', 'SEO', 'support') RETURNING id`))[0]!.id;
  const positionId = (await platformDb.query<{ id: string }>('seed', 'pos', sql`
    INSERT INTO position (organization_id, department_id, code, name, organizational_level)
    VALUES (${orgId}, ${departmentId}, 'STAFF', 'Staff', 10) RETURNING id`))[0]!.id;
  const userId = (await platformDb.query<{ id: string }>('seed', 'user', sql`
    INSERT INTO app_user (organization_id, employee_id, email, full_name, account_type, department_id, position_id)
    VALUES (${orgId}, 'EMP-CRAWL', ${`crawl-${randomUUID()}@test.invalid`}, 'Crawler', 'employee', ${departmentId}, ${positionId})
    RETURNING id`))[0]!.id;
  const ctx = createTestContext(orgId, userId);
  await platformDb.transactionForOrganization(orgId, 'seed', 'rules', (tx) => provisionSeoRules(tx, orgId));
  const site = (await registerSite(ctx, {
    clientId: null, displayUrl: siteUrl, timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
  })) as unknown as { id: string };
  await updateScanConfig(ctx, site.id, { crawlDelayMs: 0 });
  return { ctx, userId, siteId: site.id };
}

async function scan(ctx: ReturnType<typeof createTestContext>, siteId: string, userId: string) {
  const { scanRunId } = await triggerScan(ctx, siteId, userId);
  await drain(ctx);
  return db.one<{ id: string; status: string; terminationReason: string | null; fetchedCount: number; skippedCount: number }>(ctx, sql`
    SELECT id, status, termination_reason, fetched_count, skipped_count FROM seo_scan_runs WHERE id = ${scanRunId}`);
}

const findings = (ctx: ReturnType<typeof createTestContext>, siteId: string) =>
  db.query<{ id: string; ruleId: string; affectedTarget: string; status: string; severity: string }>(ctx, sql`
    SELECT id, rule_id, affected_target, status, severity FROM seo_findings WHERE site_id = ${siteId} ORDER BY rule_id, affected_target`);

describe.skipIf(!enabled)('SEO checkup end to end (fixture site, PostgreSQL)', () => {
  let server: Server;
  let origin = '';

  beforeAll(async () => {
    server = fixture(() => origin);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    registerSeoJobs();
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePools();
  });

  it('crawls each page once, judges each URL by what it is, and keeps findings accurate across checkups', async () => {
    const { ctx, userId, siteId } = await setup(origin);
    const first = await scan(ctx, siteId, userId);
    expect(first.status).toBe('completed_partial'); // /private/x is disallowed by robots.txt
    expect(first.skippedCount).toBe(1);

    const observations = await db.query<{ url: string; httpStatus: number; finalUrl: string | null; contentType: string | null; title: string | null; metaDescription: string | null; h1Texts: string[] }>(ctx, sql`
      SELECT url, http_status, final_url, content_type, title, meta_description, h1_texts
      FROM seo_page_observations WHERE scan_run_id = ${first.id} ORDER BY url`);
    const byUrl = new Map(observations.map((o) => [o.url.replace(origin, ''), o]));
    expect([...byUrl.keys()].sort()).toEqual(
      ['/', '/about', '/bad-date', '/dup-a', '/dup-b', '/dup-c', '/files/brochure.pdf', '/missing', '/new', '/old'].sort());
    expect(byUrl.get('/old')).toMatchObject({ httpStatus: 301, finalUrl: `${origin}/new`, title: null });
    expect(byUrl.get('/new')).toMatchObject({ httpStatus: 200, title: 'New page' });
    expect(byUrl.get('/files/brochure.pdf')).toMatchObject({ httpStatus: 200, contentType: 'application/pdf', title: null });
    expect(byUrl.get('/about')).toMatchObject({ metaDescription: "We're the fixture's about page, isn't it nice?", h1Texts: ['About', 'Team'] });

    const found = await findings(ctx, siteId);
    const at = (ruleId: string) => found.filter((f) => f.ruleId === ruleId).map((f) => f.affectedTarget.replace(origin, '')).sort();
    expect(at('H001')).toEqual(['/missing', '/bad-date'].sort()); // the sitemap lists a page that does not exist
    expect(at('L001')).toEqual(['/']);
    expect(at('T003')).toEqual(['/about']);
    expect(at('T009')).toEqual(['/dup-b']);
    expect(at('H009')).toEqual([]);
    expect(at('S001')).toEqual([]); // the start page is in the sitemap
    expect(at('S003')).toEqual(['/bad-date']); // listed in the sitemap but missing
    expect(found.filter((f) => f.affectedTarget === `${origin}/missing` && f.ruleId !== 'H001')).toEqual([]);
    expect(found.filter((f) => f.affectedTarget.endsWith('.pdf'))).toEqual([]);

    const alerts = await db.query<{ triggerType: string; message: string }>(ctx, sql`
      SELECT trigger_type, message FROM seo_alerts WHERE site_id = ${siteId}`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.triggerType).toBe('Critical issue detected');

    // The team dismisses the double heading; the broken page gets fixed.
    const t003 = found.find((f) => f.ruleId === 'T003')!;
    await updateFindingStatus(ctx, t003.id, { status: 'false_positive' });
    missingFixed = true;
    await scan(ctx, siteId, userId);
    const second = await findings(ctx, siteId);
    expect(second.find((f) => f.ruleId === 'H001' && f.affectedTarget.endsWith('/missing'))?.status).toBe('verified_resolved');
    expect(second.find((f) => f.ruleId === 'L001')?.status).toBe('verified_resolved');
    expect(second.find((f) => f.id === t003.id)?.status).toBe('false_positive');

    // Marking a still-present issue as fixed: the next checkup reopens it, once.
    const dup = second.find((f) => f.ruleId === 'T009')!;
    await updateFindingStatus(ctx, dup.id, { status: 'ready_for_verification' });
    await scan(ctx, siteId, userId);
    const third = await findings(ctx, siteId);
    expect(third.find((f) => f.id === dup.id)?.status).toBe('reopened');
    expect(third.find((f) => f.id === t003.id)?.status).toBe('false_positive');
    const reopenAlerts = await db.query<{ message: string }>(ctx, sql`
      SELECT message FROM seo_alerts WHERE site_id = ${siteId} AND trigger_type = 'Issue reopened'`);
    expect(reopenAlerts).toHaveLength(1);
    expect(reopenAlerts[0]!.message).toMatch(/^1 issue came back/);
  }, 60_000);

  it('reports a start page that redirects to another website instead of crawling it', async () => {
    const port = (server.address() as AddressInfo).port;
    const elsewhere = createServer((_req, res) => { res.writeHead(301, { location: `${origin}/` }); res.end(); });
    await new Promise<void>((resolve) => elsewhere.listen(0, 'localhost', resolve));
    try {
      const { ctx, userId, siteId } = await setup(`http://localhost:${(elsewhere.address() as AddressInfo).port}`);
      const run = await scan(ctx, siteId, userId);
      expect(run.status).toBe('failed');
      expect(run.terminationReason).toContain('redirects to 127.0.0.1');
      const crawled = await db.one<{ n: number }>(ctx, sql`SELECT count(*)::integer AS n FROM seo_page_observations WHERE scan_run_id = ${run.id}`);
      expect(crawled.n).toBe(1);
      void port;
    } finally {
      await new Promise<void>((resolve) => elsewhere.close(() => resolve()));
    }
  }, 30_000);
});
