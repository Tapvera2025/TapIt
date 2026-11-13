import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { __resetConfig } from '../../config.js';
import { createRequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { SearchConsoleConfigurationError } from '../../platform/integrations/google/search-console.js';
import type * as SearchConsole from '../../platform/integrations/google/search-console.js';
import { saveCompanyConnection } from './company.js';
import {
  listSearchConsoleProperties,
  searchConsoleConnected,
  searchConsoleToken,
} from './facade.js';
import { ProviderError } from './providers/types.js';

const google = vi.hoisted(() => ({
  listSites: vi.fn(),
  query: vi.fn(),
  shared: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../../platform/integrations/google/search-console.js', async (original) => ({
  ...(await original<typeof SearchConsole>()),
  listSites: google.listSites,
  querySearchAnalytics: google.query,
  sharedSearchConsoleToken: google.shared,
}));
vi.mock('./providers/index.js', () => {
  const provider = { refreshCredentials: google.refresh };
  return {
    getProvider: () => provider,
    getCompanyProvider: () => provider,
    getProviderReadiness: (platform: string) => ({ platform, status: 'ready' }),
    listProviderReadiness: () => [],
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)(
  'Search Console is read only through the organization’s own Google logins',
  () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const adminA = randomUUID();
    const adminB = randomUUID();
    const acme = randomUUID();
    const zen = randomUUID();
    const bClient = randomUUID();
    const codeA = `gsc-${orgA.slice(0, 8)}`;
    const adminQuery = <T>(fragment: ReturnType<typeof sql>) =>
      platformDb.query<T>('migration', 'isolated search console fixture', fragment);
    const ctxFor = (organizationId: string, userId: string) =>
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
    const ctxA = () => ctxFor(orgA, adminA);
    const ctxB = () => ctxFor(orgB, adminB);
    const property = (siteUrl: string, permissionLevel = 'siteOwner') => ({
      platform: 'search_console' as const,
      externalId: siteUrl,
      name: siteUrl,
      capabilities: {},
      metadata: { permissionLevel },
    });

    beforeAll(async () => {
      if (!new URL(process.env['MIGRATION_DATABASE_URL'] ?? '').pathname.includes('test'))
        throw new Error('Refusing search console fixtures outside a test database');
      vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
      // The server's shared login serves organization A only.
      vi.stubEnv('GOOGLE_SEARCH_CONSOLE_AUTH', 'oauth');
      vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'test-client');
      vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'test-secret');
      vi.stubEnv('GOOGLE_OAUTH_REFRESH_TOKEN', 'test-refresh');
      vi.stubEnv('GOOGLE_SEARCH_CONSOLE_ORGANIZATION', codeA.toUpperCase());
      __resetConfig();
      await adminQuery(
        sql`INSERT INTO organization(id,code,name) VALUES (${orgA},${codeA},'Agency A'),(${orgB},${`gsc-${orgB.slice(0, 8)}`},'Agency B')`,
      );
      for (const [id, organizationId] of [
        [adminA, orgA],
        [adminB, orgB],
      ] as const)
        await adminQuery(
          sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status) VALUES (${id},${organizationId},'super-admin',${`${id}@gsc-test.invalid`},'Admin','active')`,
        );
      for (const [id, organizationId, name, owner] of [
        [acme, orgA, 'Acme Dental', adminA],
        [zen, orgA, 'Zen Yoga', adminA],
        [bClient, orgB, 'Other Agency Client', adminB],
      ] as const)
        await adminQuery(
          sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${id},${organizationId},${name},${name},${`${id}@gsc-test.invalid`},'in','INR','Asia/Kolkata',${owner})`,
        );
      // Organization A's own Google login reads two properties; Acme's is assigned.
      await saveCompanyConnection(
        ctxA(),
        'google_business',
        { accessToken: 'org-a-token', expiresAt: '2099-01-01T00:00:00Z', scopes: [] },
        { externalAccountId: 'google-a', email: 'seo@agency-a.test' },
        [
          property('sc-domain:acmedental.in'),
          property('https://www.zenyoga.example/', 'siteFullUser'),
        ],
      );
      await adminQuery(
        sql`UPDATE social_connection_location SET client_id = ${acme} WHERE organization_id = ${orgA} AND external_id = 'sc-domain:acmedental.in'`,
      );
      google.shared.mockResolvedValue('shared-token');
      google.listSites.mockResolvedValue([
        { siteUrl: 'https://inhouse.example/', permissionLevel: 'siteOwner' },
        { siteUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://unverified.example/', permissionLevel: 'siteUnverifiedUser' },
      ]);
    });
    afterAll(async () => {
      await closePools();
      vi.unstubAllEnvs();
      __resetConfig();
    });

    it('lists only the organization’s own properties, once each, with their clients', async () => {
      const { properties, problem } = await listSearchConsoleProperties(ctxA());
      expect(problem).toBeNull();
      expect(
        properties.map((item) => [item.propertyUrl, item.source, item.clientName]),
      ).toEqual([
        ['sc-domain:acmedental.in', 'company_login', 'Acme Dental'],
        ['https://www.zenyoga.example/', 'company_login', null],
        // The shared login serves organization A, and only what it can verify.
        ['https://inhouse.example/', 'shared_login', null],
      ]);
      expect(await searchConsoleConnected(ctxB())).toBe(false);
      expect((await listSearchConsoleProperties(ctxB())).properties).toEqual([]);
    });

    it('hands out the organization’s own token, and the shared login only to its one organization', async () => {
      expect(await searchConsoleToken(ctxA(), 'sc-domain:acmedental.in')).toBe(
        'org-a-token',
      );
      expect(await searchConsoleToken(ctxA(), 'https://inhouse.example/')).toBe(
        'shared-token',
      );
      await expect(
        searchConsoleToken(ctxB(), 'sc-domain:acmedental.in'),
      ).rejects.toBeInstanceOf(SearchConsoleConfigurationError);
    });

    it('marks a login Google stopped accepting for reconnect and says so', async () => {
      await saveCompanyConnection(
        ctxB(),
        'google_business',
        {
          accessToken: 'org-b-old',
          refreshToken: 'org-b-refresh',
          expiresAt: '2026-01-01T00:00:00Z',
          scopes: [],
        },
        { externalAccountId: 'google-b', email: 'seo@agency-b.test' },
        [property('https://agency-b-client.example/')],
      );
      google.refresh.mockRejectedValueOnce(
        new ProviderError('CONNECTION_REVOKED', 'Authorization expired or was revoked.', {
          reconnectRequired: true,
        }),
      );
      await expect(
        searchConsoleToken(ctxB(), 'https://agency-b-client.example/'),
      ).rejects.toThrow(/Reconnect it under Social → Company connections/);
      const [login] = await adminQuery<{ status: string }>(
        sql`SELECT status FROM social_connection WHERE organization_id = ${orgB} AND external_account_id = 'google-b'`,
      );
      expect(login).toEqual({ status: 'reconnect_required' });
      const notices = await adminQuery<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM notification_outbox WHERE organization_id = ${orgB} AND payload->>'type' = 'social.connection_reconnect_required'`,
      );
      expect(notices).toEqual([{ count: 1 }]);
    });
  },
);
