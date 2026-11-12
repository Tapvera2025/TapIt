import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createRequestContext,
  type RequestContext,
} from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import type { SearchAnalyticsRequest } from '../../../platform/integrations/google/search-console.js';
import type * as SearchConsole from '../../../platform/integrations/google/search-console.js';
import {
  getSearchConsoleSettings,
  linkSearchConsoleProperty,
  syncSearchConsoleRanks,
} from './service.js';

const access = vi.hoisted(() => ({ orgA: '', acme: '', query: vi.fn() }));
vi.mock('../../../platform/integrations/google/search-console.js', async (original) => ({
  ...(await original<typeof SearchConsole>()),
  querySearchAnalytics: access.query,
}));
// Social's facade: organization A's own Google login reads two properties; B has none.
vi.mock('../../social/facade.js', async () => {
  const { SearchConsoleConfigurationError: ConfigurationError } =
    await import('../../../platform/integrations/google/search-console.js');
  const property = (
    propertyUrl: string,
    clientId: string | null,
    clientName: string | null,
  ) => ({
    propertyUrl,
    permissionLevel: 'siteOwner',
    clientId,
    clientName,
    source: 'company_login',
    account: 'seo@agency-a.test',
    status: 'connected',
  });
  const isA = (ctx: { organizationId: string }) => ctx.organizationId === access.orgA;
  return {
    searchConsoleConnected: async (ctx: { organizationId: string }) => isA(ctx),
    listSearchConsoleProperties: async (ctx: { organizationId: string }) => ({
      properties: isA(ctx)
        ? [
            property('https://www.zenyoga.example/', null, null),
            property('sc-domain:acmedental.in', access.acme, 'Acme Dental'),
          ]
        : [],
      problem: null,
    }),
    searchConsoleToken: async (ctx: { organizationId: string }, propertyUrl: string) => {
      if (isA(ctx)) return 'org-a-token';
      throw new ConfigurationError(
        `None of your organization’s Google logins can read ${propertyUrl}.`,
      );
    },
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)(
  'Project Search Console reads through the organization’s own Google logins',
  () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const adminA = randomUUID();
    const adminB = randomUUID();
    const acme = randomUUID();
    const bClient = randomUUID();
    const acmeProject = randomUUID();
    const bProject = randomUUID();
    access.orgA = orgA;
    access.acme = acme;
    const adminQuery = <T>(fragment: ReturnType<typeof sql>) =>
      platformDb.query<T>(
        'migration',
        'isolated project search console fixture',
        fragment,
      );
    const ctxFor = (organizationId: string, userId: string): RequestContext =>
      createRequestContext({
        organizationId,
        principal: {
          id: userId,
          organizationId,
          accountType: 'super-admin',
          sessionVersion: 0,
        },
        requestId: randomUUID(),
      });

    beforeAll(async () => {
      if (!new URL(process.env['MIGRATION_DATABASE_URL'] ?? '').pathname.includes('test'))
        throw new Error(
          'Refusing project search console fixtures outside a test database',
        );
      await adminQuery(
        sql`INSERT INTO organization(id,code,name) VALUES (${orgA},${`psc-${orgA.slice(0, 8)}`},'Agency A'),(${orgB},${`psc-${orgB.slice(0, 8)}`},'Agency B')`,
      );
      for (const [id, organizationId] of [
        [adminA, orgA],
        [adminB, orgB],
      ] as const)
        await adminQuery(
          sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status) VALUES (${id},${organizationId},'super-admin',${`${id}@psc-test.invalid`},'Admin','active')`,
        );
      for (const [id, organizationId, owner] of [
        [acme, orgA, adminA],
        [bClient, orgB, adminB],
      ] as const)
        await adminQuery(
          sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${id},${organizationId},'Client','Client',${`${id}@psc-test.invalid`},'in','INR','Asia/Kolkata',${owner})`,
        );
      for (const [id, organizationId, clientId, owner] of [
        [acmeProject, orgA, acme, adminA],
        [bProject, orgB, bClient, adminB],
      ] as const) {
        await adminQuery(
          sql`INSERT INTO project(id,organization_id,client_id,name,priority,start_date,currency,created_by) VALUES (${id},${organizationId},${clientId},'SEO retainer','medium','2026-01-01','INR',${owner})`,
        );
        await adminQuery(
          sql`INSERT INTO project_seo_keyword(organization_id,project_id,keyword,category,auto_fetch_frequency,created_by) VALUES (${organizationId},${id},'dentist bandra','seo','daily',${owner})`,
        );
      }
    });
    afterAll(async () => {
      await closePools();
    });

    it("offers the project's client's property first and links only properties the organization can read", async () => {
      const settings = await getSearchConsoleSettings(ctxFor(orgA, adminA), acmeProject);
      expect(settings.configured).toBe(true);
      expect(
        settings.properties.map((item) => [item.propertyUrl, item.forThisClient]),
      ).toEqual([
        ['sc-domain:acmedental.in', true],
        ['https://www.zenyoga.example/', false],
      ]);
      await expect(
        linkSearchConsoleProperty(ctxFor(orgA, adminA), acmeProject, {
          propertyUrl: 'https://someone-else.example/',
        }),
      ).rejects.toMatchObject({ status: 422 });
      const link = await linkSearchConsoleProperty(ctxFor(orgA, adminA), acmeProject, {
        propertyUrl: 'sc-domain:acmedental.in',
      });
      expect(link).toMatchObject({ propertyUrl: 'sc-domain:acmedental.in' });
    });

    it("fetches ranks with the organization's own token", async () => {
      access.query.mockImplementation(
        async (_url: string, _request: SearchAnalyticsRequest, token: string) =>
          token === 'org-a-token'
            ? [
                {
                  keys: ['dentist bandra'],
                  clicks: 3,
                  impressions: 90,
                  ctr: 0.033,
                  position: 6.4,
                },
              ]
            : [],
      );
      const outcome = await syncSearchConsoleRanks(ctxFor(orgA, adminA), acmeProject);
      expect(outcome).toMatchObject({ status: 'ok', fetched: 1 });
      expect(access.query).toHaveBeenCalledWith(
        'sc-domain:acmedental.in',
        expect.objectContaining({ dimensions: ['query'] }),
        'org-a-token',
      );
    });

    it('never lets another organization link or read a property it has no login for', async () => {
      const ctxB = ctxFor(orgB, adminB);
      expect(await getSearchConsoleSettings(ctxB, bProject)).toMatchObject({
        configured: false,
        properties: [],
      });
      await expect(
        linkSearchConsoleProperty(ctxB, bProject, {
          propertyUrl: 'sc-domain:acmedental.in',
        }),
      ).rejects.toMatchObject({ status: 422 });
      // Even a link written straight into the table is never read.
      await adminQuery(
        sql`INSERT INTO project_seo_search_console(organization_id,project_id,property_url,property_type,created_by) VALUES (${orgB},${bProject},'sc-domain:acmedental.in','domain',${adminB})`,
      );
      access.query.mockClear();
      const outcome = await syncSearchConsoleRanks(ctxB, bProject);
      expect(outcome).toMatchObject({ status: 'failed', fetched: 0 });
      expect(outcome.message).toMatch(/Company connections/);
      expect(access.query).not.toHaveBeenCalled();
    });
  },
);
