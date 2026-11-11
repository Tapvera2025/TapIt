/**
 * SEO Intelligence integration test — exercises the DB round-trip for every
 * SELECT/INSERT/UPDATE the service layer touches on happy-path scenarios.
 *
 * Gated on TAPCRM_INTEGRATION_DB=1 so CI without a Postgres fixture skips it:
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… \
 *     npx vitest run packages/server/src/modules/seo-intelligence/seo.integration.test.ts
 *
 * What this guards against:
 *   - The snake_case / camelCase bug class — any raw SELECT that returns rows
 *     the service tries to read as snake_case would blow up here, because the
 *     DAL camelizes but TypeScript annotations can lie.
 *   - Dynamic UPDATEs with broken parameter binding (updateSite was shipping
 *     broken until this session).
 *   - Missing-column errors (seo_backlinks.domain_rating was referenced in
 *     service.getBacklinks ORDER BY before the column existed).
 *   - Policy loader failures when a site resource is looked up.
 *
 * What this does NOT cover (yet):
 *   - End-to-end crawl → fetch → evaluate pipeline (would need network mock
 *     + BullMQ orchestration). Pure unit tests cover the hydration + rules
 *     paths; adding full pipeline coverage is a separate task.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { createTestContext } from '../../platform/test-helpers.js';
import {
  getSiteList, getSiteDetail, registerSite, patchSite,
  getFindings, getFindingsTrend, updateFindingStatus,
  getAlerts, acknowledgeAlert,
  getBacklinks, getCwvObservations, getRules,
} from './service.js';
import { provisionSeoRules } from './provisioning.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

async function setup() {
  const orgId = (await platformDb.query<{ id: string }>('seed', 'create org',
    sql`INSERT INTO organization (code, name)
        VALUES ('SEO' || replace(gen_random_uuid()::text, '-', ''), 'SEO Test') RETURNING id`
  ))[0]!.id;

  const departmentId = (await platformDb.query<{ id: string }>('seed', 'create dept',
    sql`INSERT INTO department (organization_id, code, name, kind)
        VALUES (${orgId}, 'SEO', 'SEO', 'support') RETURNING id`
  ))[0]!.id;
  const positionId = (await platformDb.query<{ id: string }>('seed', 'create pos',
    sql`INSERT INTO position (organization_id, department_id, code, name, organizational_level)
        VALUES (${orgId}, ${departmentId}, 'STAFF', 'Staff', 10) RETURNING id`
  ))[0]!.id;

  const userId = (await platformDb.query<{ id: string }>('seed', 'create user',
    sql`INSERT INTO app_user
          (organization_id, employee_id, email, full_name, account_type, department_id, position_id)
        VALUES (${orgId}, 'EMP-SEO001', ${`seo-${randomUUID()}@test.invalid`}, 'SEO Tester', 'employee',
                ${departmentId}, ${positionId}) RETURNING id`
  ))[0]!.id;

  const ctx = createTestContext(orgId, userId);

  // Seed the per-tenant rule registry so the Rules panel has something to list.
  await platformDb.transactionForOrganization(orgId, 'seed', 'provision seo rules', async (tx) => {
    await provisionSeoRules(tx, orgId);
  });

  return { orgId, userId, ctx };
}

async function setupTrendSite(host = 'trend.example.com') {
  const fixture = await setup();
  const site = await registerSite(fixture.ctx, {
    clientId: null, displayUrl: `https://${host}`,
    timezone: 'Pacific/Honolulu', locale: 'en', businessIntents: [], stackNotes: null,
  });
  const siteId = (site as unknown as { id: string }).id;
  const configId = randomUUID();
  const scanRunId = randomUUID();
  await db.query(fixture.ctx, sql`
    INSERT INTO seo_scan_configs (id, organization_id, site_id)
    VALUES (${configId}, ${fixture.orgId}, ${siteId})
  `);
  await db.query(fixture.ctx, sql`
    INSERT INTO seo_scan_runs (id, organization_id, site_id, config_id, status)
    VALUES (${scanRunId}, ${fixture.orgId}, ${siteId}, ${configId}, 'completed')
  `);
  return { ...fixture, siteId, scanRunId };
}

async function seedTrendFinding(
  fixture: Awaited<ReturnType<typeof setupTrendSite>>,
  severity: string,
  firstSeenAt: Date,
  resolvedAt: Date | null = null,
) {
  const id = randomUUID();
  await db.query(fixture.ctx, sql`
    INSERT INTO seo_findings
      (id, site_id, organization_id, rule_id, rule_version, signature,
       affected_target, status, severity, confidence, first_seen_run, latest_run,
       first_seen_at, resolved_at)
    VALUES (${id}, ${fixture.siteId}, ${fixture.orgId}, 'M001', 'v1',
            ${`trend-${id}`}, 'https://trend.example.com/',
            ${resolvedAt ? 'verified_resolved' : 'open'}, ${severity}, 'direct',
            ${fixture.scanRunId}, ${fixture.scanRunId}, ${firstSeenAt}, ${resolvedAt})
  `);
  return id;
}

describe.skipIf(!enabled)('SEO Intelligence integration', () => {
  afterAll(closePools);

  it('registers a new site with normalized host', async () => {
    const { ctx } = await setup();
    const site = await registerSite(ctx, {
      clientId: null,
      displayUrl: 'https://example.com',
      timezone: 'UTC',
      locale: 'en',
      businessIntents: [],
      stackNotes: null,
    });
    // DbSeoSite declares snake_case fields but the DAL camelizes at the boundary.
    // Access via Record<string, unknown> so TypeScript doesn't fight the runtime shape.
    const row = site as unknown as Record<string, unknown>;
    expect(row['id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(row['displayUrl']).toBe('https://example.com');
    expect(row['normalizedHost']).toBe('example.com');
    expect(row['active']).toBe(true);
  });

  it('rejects a duplicate site in the same org', async () => {
    const { ctx } = await setup();
    await registerSite(ctx, {
      clientId: null, displayUrl: 'https://dup.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    });
    await expect(registerSite(ctx, {
      clientId: null, displayUrl: 'https://dup.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    })).rejects.toThrow(/already registered/i);
  });

  it('lists sites and returns them camelized', async () => {
    const { ctx } = await setup();
    await registerSite(ctx, {
      clientId: null, displayUrl: 'https://list.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: ['saas'], stackNotes: 'notes',
    });
    const sites = (await getSiteList(ctx)) as unknown as Array<Record<string, unknown>>;
    expect(sites.length).toBeGreaterThan(0);
    const site = sites.find((s) => s['displayUrl'] === 'https://list.example.com');
    expect(site).toBeDefined();
    expect(site?.['businessIntents']).toBeDefined();
  });

  it('patches a site (regression: updateSite SET clause SQL binding)', async () => {
    const { ctx } = await setup();
    const site = await registerSite(ctx, {
      clientId: null, displayUrl: 'https://patch.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    });
    const siteId = (site as unknown as { id: string }).id;
    const updated = await patchSite(ctx, siteId, { timezone: 'Asia/Kolkata', stack_notes: 'updated' }) as unknown as Record<string, unknown>;
    expect(updated['timezone']).toBe('Asia/Kolkata');
    expect(updated['stackNotes']).toBe('updated');

    // Confirm the row actually persisted — not just that the UPDATE RETURNING faked it.
    const refetch = (await getSiteDetail(ctx, siteId)) as unknown as Record<string, unknown>;
    expect(refetch['timezone']).toBe('Asia/Kolkata');
    expect(refetch['stackNotes']).toBe('updated');
  });

  it('returns per-tenant rules after provisioning', async () => {
    const { ctx } = await setup();
    const rules = await getRules(ctx);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(10);
    // Spot-check one well-known rule flows through.
    const m001 = (rules as Array<{ ruleId: string; group: string; severity: string }>).find(r => r.ruleId === 'M001');
    expect(m001).toBeDefined();
    expect(m001?.severity).toBe('high');
  });

  it('returns empty collections for a site with no data (not throws)', async () => {
    const { ctx } = await setup();
    const site = await registerSite(ctx, {
      clientId: null, displayUrl: 'https://empty.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    });
    const siteId = (site as unknown as { id: string }).id;

    // Each of these touches a SELECT. The regression-protection here is that
    // these queries don't reference non-existent columns or indices.
    const [findings, alerts, backlinks, cwv] = await Promise.all([
      getFindings(ctx, siteId, {}),
      getAlerts(ctx, siteId),
      getBacklinks(ctx, siteId, {}),
      getCwvObservations(ctx, siteId, {}),
    ]);

    expect(findings.rows).toEqual([]);
    expect(alerts).toEqual([]);
    expect(backlinks).toEqual([]);
    expect(cwv).toEqual([]);
  });

  it('acknowledges an alert end-to-end (regression: dynamic UPDATE)', async () => {
    const { ctx, userId, orgId } = await setup();
    const site = await registerSite(ctx, {
      clientId: null, displayUrl: 'https://alert.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    });
    const siteId = (site as unknown as { id: string }).id;

    // Insert an alert directly — normally these come from the evaluate job.
    const alertId = randomUUID();
    await db.query(ctx, sql`
      INSERT INTO seo_alerts (id, site_id, organization_id, trigger_type, dedup_key, severity, message)
      VALUES (${alertId}, ${siteId}, ${orgId}, 'Critical issue detected',
              ${'test-' + alertId}, 'critical', 'Test alert')
    `);

    const before = await getAlerts(ctx, siteId);
    expect(before).toHaveLength(1);
    expect((before[0] as { acknowledgedAt: Date | null }).acknowledgedAt).toBeNull();

    const acked = await acknowledgeAlert(ctx, alertId, userId);
    expect((acked as { acknowledgedAt: Date }).acknowledgedAt).toBeDefined();

    const after = await getAlerts(ctx, siteId);
    expect((after[0] as { acknowledgedAt: Date | null }).acknowledgedAt).not.toBeNull();
  });

  it('updates a finding status without SQL errors (regression: dynamic UPDATE)', async () => {
    const { ctx, orgId } = await setup();
    const site = await registerSite(ctx, {
      clientId: null, displayUrl: 'https://finding.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    });
    const siteId = (site as unknown as { id: string }).id;

    // Seed a config + scan_run + finding — this needs the full foreign-key graph.
    const configId = randomUUID();
    await db.query(ctx, sql`
      INSERT INTO seo_scan_configs (id, organization_id, site_id)
      VALUES (${configId}, ${orgId}, ${siteId})
    `);
    const scanRunId = randomUUID();
    await db.query(ctx, sql`
      INSERT INTO seo_scan_runs (id, organization_id, site_id, config_id, status)
      VALUES (${scanRunId}, ${orgId}, ${siteId}, ${configId}, 'completed')
    `);
    const findingId = randomUUID();
    await db.query(ctx, sql`
      INSERT INTO seo_findings
        (id, site_id, organization_id, rule_id, rule_version, signature,
         affected_target, severity, confidence, first_seen_run, latest_run)
      VALUES (${findingId}, ${siteId}, ${orgId}, 'M001', 'v1',
              ${'sig-' + findingId}, 'https://finding.example.com/', 'high', 'direct',
              ${scanRunId}, ${scanRunId})
    `);

    const updated = await updateFindingStatus(ctx, findingId, { status: 'accepted_exception' });
    expect(updated).toBeDefined();

    const page = await getFindings(ctx, siteId, { status: 'accepted_exception' });
    expect(page.rows).toHaveLength(1);
  });

  it('zero-fills every requested UTC day and severity and rejects another tenant\'s site', async () => {
    const fixture = await setupTrendSite();
    const points = await getFindingsTrend(fixture.ctx, fixture.siteId, 3);
    expect(points).toHaveLength(15);
    expect(new Set(points.map(point => point.day)).size).toBe(3);
    expect(points.every(point => /^\d{4}-\d{2}-\d{2}$/.test(point.day) && point.openCount === 0)).toBe(true);
    for (const day of new Set(points.map(point => point.day))) {
      expect(points.filter(point => point.day === day).map(point => point.severity).sort())
        .toEqual(['critical', 'high', 'informational', 'low', 'moderate']);
    }
    expect(await getFindingsTrend(fixture.ctx, fixture.siteId, 1)).toHaveLength(5);
    expect(await getFindingsTrend(fixture.ctx, fixture.siteId, 180)).toHaveLength(900);

    const otherTenant = await setupTrendSite('other-tenant.example.com');
    await expect(getFindingsTrend(otherTenant.ctx, fixture.siteId, 3)).rejects.toThrow(/not found|not accessible/i);
  });

  it('counts first sightings and resolutions at UTC day boundaries without leaking another site', async () => {
    const fixture = await setupTrendSite();
    const { day } = await db.one<{ day: string }>(fixture.ctx,
      sql`SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day`);
    const midnight = new Date(`${day}T00:00:00.000Z`).getTime();
    const dateAt = (days: number, hours = 0, minutes = 0) => new Date(midnight + days * 86_400_000 + hours * 3_600_000 + minutes * 60_000);
    const dayAt = (days: number) => dateAt(days).toISOString().slice(0, 10);

    await seedTrendFinding(fixture, 'high', dateAt(-3));
    // A resolution at midnight still leaves the finding open at the end of the preceding day.
    await seedTrendFinding(fixture, 'critical', dateAt(-2, 23, 30), dateAt(-1));
    await seedTrendFinding(fixture, 'low', dateAt(-2), dateAt(-2, 23, 59));
    await seedTrendFinding(fixture, 'moderate', dateAt(0));
    await seedTrendFinding(fixture, 'informational', dateAt(1));

    const otherSite = await registerSite(fixture.ctx, {
      clientId: null, displayUrl: 'https://other-site.example.com',
      timezone: 'UTC', locale: 'en', businessIntents: [], stackNotes: null,
    });
    await seedTrendFinding({ ...fixture, siteId: (otherSite as unknown as { id: string }).id }, 'high', dateAt(-3));

    const points = await getFindingsTrend(fixture.ctx, fixture.siteId, 3);
    const count = (offset: number, severity: string) => points.find(point => point.day === dayAt(offset) && point.severity === severity)?.openCount;
    expect([-2, -1, 0].map(offset => count(offset, 'high'))).toEqual([1, 1, 1]);
    expect([-2, -1, 0].map(offset => count(offset, 'critical'))).toEqual([1, 0, 0]);
    expect([-2, -1, 0].map(offset => count(offset, 'moderate'))).toEqual([0, 0, 1]);
    expect(points.filter(point => point.severity === 'low' || point.severity === 'informational').every(point => point.openCount === 0)).toBe(true);
  });

  it('persists dismissal/resolution timestamps and makes today\'s trend follow finding status changes', async () => {
    const fixture = await setupTrendSite();
    const findingId = await seedTrendFinding(fixture, 'high', new Date('2020-01-01T00:00:00Z'));
    const latestCount = async () => (await getFindingsTrend(fixture.ctx, fixture.siteId, 1)).find(point => point.severity === 'high')?.openCount;
    expect(await latestCount()).toBe(1);

    const dismissed = await updateFindingStatus(fixture.ctx, findingId, { status: 'dismissed' }) as { status: string; resolvedAt: Date | null };
    expect(dismissed.status).toBe('false_positive');
    expect(dismissed.resolvedAt).toBeInstanceOf(Date);
    expect((await getFindings(fixture.ctx, fixture.siteId, { status: 'dismissed' })).rows).toHaveLength(1);
    expect(await latestCount()).toBe(0);

    const repeated = await updateFindingStatus(fixture.ctx, findingId, { status: 'dismissed' }) as { resolvedAt: Date };
    expect(repeated.resolvedAt).toEqual(dismissed.resolvedAt);
    await updateFindingStatus(fixture.ctx, findingId, { status: 'reopened' });
    expect(await latestCount()).toBe(1);

    const resolved = await updateFindingStatus(fixture.ctx, findingId, { status: 'resolved' }) as { status: string; resolvedAt: Date | null };
    expect(resolved.status).toBe('verified_resolved');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect((await getFindings(fixture.ctx, fixture.siteId, { status: 'resolved' })).rows).toHaveLength(1);
    expect(await latestCount()).toBe(0);
  });
});
