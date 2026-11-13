import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { __resetConfig } from '../../config.js';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  __resetStorageService,
  __setStorageService,
} from '../../platform/storage/index.js';
import { runPublishingSweep } from './jobs.js';
import { ProviderError } from './providers/types.js';

const fake = vi.hoisted(() => ({
  exchange: vi.fn(),
  identity: vi.fn(),
  discover: vi.fn(),
  properties: vi.fn(
    async (): Promise<{ siteUrl: string; permissionLevel: string }[]> => [],
  ),
  refresh: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('./providers/index.js', () => {
  const capabilities = {
    publishText: true,
    publishImages: true,
    publishVideo: true,
    accountInsights: false,
    postInsights: false,
  };
  const readiness = (platform: string) => ({
    platform,
    name: platform,
    status: 'ready',
    message: 'TEST ONLY',
    capabilities,
  });
  const provider = (platform: string) => ({
    platform,
    supportsPkce: true,
    capabilities,
    validatePost: () => [],
    getAuthorizationUrl: ({
      state,
      codeChallenge,
    }: {
      state: string;
      codeChallenge: string;
    }) =>
      `https://provider.test/authorize?${new URLSearchParams({ state, code_challenge: codeChallenge }).toString()}`,
    exchangeCode: fake.exchange,
    getAuthorizedIdentity: fake.identity,
    discoverAccounts: fake.discover,
    refreshCredentials: fake.refresh,
    publishPost: fake.publish,
    revoke: fake.revoke,
    // Only a Google sign-in lists Search Console properties.
    ...(platform === 'google_business'
      ? { listSearchConsoleProperties: fake.properties }
      : {}),
  });
  return {
    getProviderReadiness: readiness,
    listProviderReadiness: () => ['google_business', 'facebook'].map(readiness),
    getProvider: provider,
    getCompanyProvider: provider,
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)(
  'Company logins: one Facebook login for Pages and Instagram, Search Console properties per client',
  () => {
    const org = randomUUID();
    const otherOrg = randomUUID();
    const owner = randomUUID();
    const admin = randomUUID();
    const department = randomUUID();
    const position = randomUUID();
    const acme = randomUUID();
    const zen = randomUUID();
    let app: ReturnType<typeof buildApp>;
    const capabilities = {
      publishText: true,
      publishImages: true,
      publishVideo: true,
      accountInsights: false,
      postInsights: false,
    };
    const adminQuery = <T>(fragment: ReturnType<typeof sql>) =>
      platformDb.query<T>('migration', 'isolated company login fixture', fragment);
    const jobCtx = () =>
      createJobContext({
        organizationId: org,
        principal: systemPrincipal(org),
        jobName: 'social-company-login-test',
        runId: randomUUID(),
      });
    const headers = (userId = admin, organizationId = org) => ({
      'x-dev-user-id': userId,
      'x-dev-organization-id': organizationId,
    });
    const company = '/api/social/company-connections';
    const workspace = (clientId: string) => `/api/social/clients/${clientId}`;
    const asset = (
      platform: 'facebook' | 'instagram' | 'google_business',
      externalId: string,
      name: string,
      metadata: Record<string, unknown> = {},
    ) => ({
      platform,
      externalId,
      name,
      capabilities,
      // Discovery hands Page tokens to client sign-ins; a company login never stores them.
      credentials: { accessToken: `page-token-${externalId}`, scopes: [] },
      metadata,
    });

    interface Location {
      id: string;
      platform: string;
      externalId: string;
      name: string;
      status: string;
      detail: string | null;
      websiteUrl: string | null;
      assignment: { clientId: string; accountId: string | null; via: string } | null;
      suggestion: { clientId: string; clientName: string; reason: string } | null;
    }

    async function connect(input: {
      platform: 'facebook' | 'google_business';
      sub: string;
      name?: string;
      email?: string;
      token: string;
      assets: ReturnType<typeof asset>[];
    }) {
      fake.exchange.mockResolvedValueOnce({
        accessToken: input.token,
        expiresAt: '2099-01-01T00:00:00Z',
        scopes: ['test-scope'],
        metadata: { tokenType: 'user' },
      });
      fake.identity.mockResolvedValueOnce({
        externalAccountId: input.sub,
        ...(input.name ? { name: input.name } : {}),
        ...(input.email ? { email: input.email } : {}),
      });
      fake.discover.mockResolvedValueOnce(input.assets);
      const started = await request(app)
        .post(`${company}/oauth/${input.platform}/start`)
        .set(headers())
        .send({});
      expect(started.status).toBe(201);
      const state = new URL(
        started.body.data.authorizationUrl as string,
      ).searchParams.get('state')!;
      const cookie = (started.headers['set-cookie'] as unknown as string[])[0]!.split(
        ';',
      )[0]!;
      const callback = await request(app)
        .get(
          `/api/social/oauth/${input.platform}/callback?${new URLSearchParams({ code: 'code', state }).toString()}`,
        )
        .set('Cookie', cookie);
      expect(callback.status).toBe(303);
      const payload = JSON.parse(
        decodeURIComponent(
          (callback.headers['location'] as string).split('#social-oauth=')[1]!,
        ),
      ) as Record<string, unknown>;
      expect(payload).toMatchObject({ scope: 'company', platform: input.platform });
      return request(app)
        .post(`${company}/oauth/${input.platform}/complete`)
        .set(headers())
        .set('Cookie', cookie)
        .send({ code: payload['code'], state: payload['state'] });
    }
    async function locations(connectionId: string): Promise<Location[]> {
      const response = await request(app)
        .get(`${company}/${connectionId}/locations`)
        .set(headers());
      expect(response.status).toBe(200);
      return response.body.data as Location[];
    }
    const assign = (connectionId: string, locationId: string, clientId: string | null) =>
      request(app)
        .put(`${company}/${connectionId}/locations/${locationId}/client`)
        .set(headers())
        .send({ clientId });
    async function clientAccounts(clientId: string) {
      const response = await request(app)
        .get(`${workspace(clientId)}/accounts`)
        .set(headers(owner));
      expect(response.status).toBe(200);
      return response.body.data as {
        id: string;
        platform: string;
        externalId: string;
        status: string;
        connectionScope: string;
      }[];
    }

    beforeAll(async () => {
      __setStorageService({
        async putObject({ body }) {
          return { checksumSha256: createHash('sha256').update(body).digest('hex') };
        },
        async getObject() {
          throw new Error('No media in these tests');
        },
        async headObject() {
          throw new Error('No media in these tests');
        },
        async deleteObject() {},
        presignedGetUrl({ key }) {
          return `https://files.example.com/${key}`;
        },
      });
      if (!new URL(process.env['MIGRATION_DATABASE_URL'] ?? '').pathname.includes('test'))
        throw new Error('Refusing company login fixtures outside a test database');
      vi.stubEnv('IDENTITY_DEV_BYPASS', 'true');
      vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'ef'.repeat(32));
      vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
      __resetConfig();
      await adminQuery(
        sql`INSERT INTO organization(id,code,name) VALUES (${org},${`logins-${org.slice(0, 8)}`},'Agency A'),(${otherOrg},${`logins-${otherOrg.slice(0, 8)}`},'Agency B')`,
      );
      await adminQuery(
        sql`INSERT INTO department(id,organization_id,code,name,kind) VALUES (${department},${org},'SOCIAL','Social','support')`,
      );
      await adminQuery(
        sql`INSERT INTO position(id,organization_id,department_id,code,name,organizational_level) VALUES (${position},${org},${department},'SOCIAL','Social',10)`,
      );
      for (const [id, type, email, fullName] of [
        [owner, 'employee', 'owner@logins-test.invalid', 'Social Manager'],
        [admin, 'super-admin', 'admin@logins-test.invalid', 'Company Admin'],
      ] as const) {
        await adminQuery(sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status,department_id,position_id,employee_id)
          VALUES (${id},${org},${type},${`${org}-${email}`},${fullName},'active',${type === 'employee' ? department : null},${type === 'employee' ? position : null},${id.toUpperCase()})`);
      }
      await adminQuery(
        sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status) VALUES (${otherOrg},${otherOrg},'super-admin',${`${otherOrg}@logins-test.invalid`},'Other Admin','active')`,
      );
      // Acme's own email domain is a website hint; Zen uses a mailbox provider.
      for (const [id, name, email] of [
        [acme, 'Acme Dental', `info-${acme.slice(0, 8)}@acmedental.in`],
        [zen, 'Zen Yoga', `zen-${zen.slice(0, 8)}@gmail.com`],
      ] as const) {
        await adminQuery(
          sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${id},${org},${name},${name},${email},'in','INR','Asia/Kolkata',${owner})`,
        );
      }
      for (const organizationId of [org, otherOrg])
        await adminQuery(
          sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${organizationId},id FROM module WHERE key = 'social'`,
        );
      await adminQuery(
        sql`INSERT INTO position_policy(organization_id,position_id,action,allowed,scope) SELECT ${org},${position},action,true,'own' FROM registry_action WHERE module = 'social'`,
      );
      app = buildApp();
    });
    afterAll(async () => {
      __resetStorageService();
      await closePools();
      vi.unstubAllEnvs();
    });

    let metaConnection = '';
    it('connects one Facebook login and lists its Pages and Instagram accounts with suggested clients', async () => {
      const connected = await connect({
        platform: 'facebook',
        sub: '5550001',
        name: 'Riya at Agency A',
        token: 'meta-user-token',
        assets: [
          asset('facebook', '101', 'Acme Dental Clinic', {
            tasks: ['CREATE_CONTENT'],
            websiteUri: 'https://www.acmedental.in/',
          }),
          asset('instagram', '17841', 'Acme Dental', {
            pageId: '101',
            username: 'acmedental',
            accountType: 'professional',
            websiteUri: 'https://acmedental.in/book',
          }),
          asset('facebook', '102', 'Zen Yoga', { tasks: ['CREATE_CONTENT'] }),
          asset('facebook', '103', 'Corner Bakery', { tasks: ['CREATE_CONTENT'] }),
          // A Google location never lands on a Meta login.
          asset('google_business', 'locations/9', 'Stray location'),
        ],
      });
      expect(connected.status).toBe(201);
      expect(connected.body.data).toMatchObject({
        platform: 'facebook',
        accountName: 'Riya at Agency A',
        accountEmail: null,
        status: 'connected',
        locationCount: 4,
        assignedCount: 0,
      });
      expect(JSON.stringify(connected.body)).not.toContain('meta-user-token');
      metaConnection = connected.body.data.id as string;

      const listed = await locations(metaConnection);
      const byId = Object.fromEntries(listed.map((item) => [item.externalId, item]));
      expect(Object.keys(byId).sort()).toEqual(['101', '102', '103', '17841']);
      expect(byId['17841']).toMatchObject({
        platform: 'instagram',
        detail: '@acmedental',
      });
      expect(byId['101']!.suggestion).toEqual({
        clientId: acme,
        clientName: 'Acme Dental',
        reason: 'website',
      });
      expect(byId['17841']!.suggestion).toMatchObject({
        clientId: acme,
        reason: 'website',
      });
      expect(byId['102']!.suggestion).toMatchObject({ clientId: zen, reason: 'name' });
      expect(byId['103']!.suggestion).toBeNull();
      // Discovery's Page tokens are never kept with the locations.
      const stored = await adminQuery<{ metadata: unknown }>(
        sql`SELECT metadata FROM social_connection_location WHERE connection_id = ${metaConnection}`,
      );
      expect(JSON.stringify(stored)).not.toContain('page-token');
    });

    it('publishes to an assigned Instagram account with the Facebook login it came from', async () => {
      const listed = await locations(metaConnection);
      const id = (externalId: string) =>
        listed.find((item) => item.externalId === externalId)!.id;
      expect((await assign(metaConnection, id('101'), acme)).status).toBe(200);
      const instagram = await assign(metaConnection, id('17841'), acme);
      expect(instagram.status).toBe(200);
      expect(instagram.body.data.assignment).toMatchObject({
        clientId: acme,
        via: 'company_connection',
      });
      const accounts = await clientAccounts(acme);
      expect(
        accounts.map((item) => [item.platform, item.connectionScope]).sort(),
      ).toEqual([
        ['facebook', 'company'],
        ['instagram', 'company'],
      ]);

      fake.publish.mockResolvedValueOnce({
        externalPostId: 'ig-media-1',
        url: 'https://www.instagram.com/p/x',
      });
      const account = accounts.find((item) => item.platform === 'instagram')!;
      const created = await request(app)
        .post(`${workspace(acme)}/posts`)
        .set(headers(owner))
        .send({
          caption: 'Smile week',
          accountIds: [account.id],
          mediaIds: [],
          intent: 'draft',
        });
      expect(created.status).toBe(201);
      expect(
        (
          await request(app)
            .post(`${workspace(acme)}/posts/${created.body.data.id}/publish`)
            .set(headers(owner))
            .send({})
        ).status,
      ).toBe(201);
      await runPublishingSweep(jobCtx());
      // The Instagram account's token is the company Facebook login's, sealed for it.
      expect(fake.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          account: expect.objectContaining({
            platform: 'instagram',
            externalId: '17841',
          }),
          credentials: expect.objectContaining({ accessToken: 'meta-user-token' }),
        }),
      );
      const detail = await request(app)
        .get(`${workspace(acme)}/posts/${created.body.data.id}`)
        .set(headers(owner));
      expect(detail.body.data.status).toBe('published');
    });

    it('keeps publishing to Pages with their own tokens after the Facebook login expires', async () => {
      // The Page's own token, as Meta discovery hands it to a company login. The
      // Instagram account publishes with its Page's token.
      const withPageToken = (item: ReturnType<typeof asset>, pageId: string) => ({
        ...item,
        locationCredentials: {
          accessToken: `own-page-token-${pageId}`,
          scopes: [],
          metadata: { pageId },
        },
      });
      const pages = () => [
        withPageToken(
          asset('facebook', '101', 'Acme Dental Clinic', { tasks: ['CREATE_CONTENT'] }),
          '101',
        ),
        withPageToken(
          asset('instagram', '17841', 'Acme Dental', {
            pageId: '101',
            username: 'acmedental',
          }),
          '101',
        ),
        withPageToken(
          asset('facebook', '102', 'Zen Yoga', { tasks: ['CREATE_CONTENT'] }),
          '102',
        ),
        withPageToken(
          asset('facebook', '103', 'Corner Bakery', { tasks: ['CREATE_CONTENT'] }),
          '103',
        ),
      ];
      fake.discover.mockResolvedValueOnce(pages());
      const refreshed = await request(app)
        .post(`${company}/${metaConnection}/sync`)
        .set(headers())
        .send({});
      expect(refreshed.status).toBe(201);
      const sealed = await adminQuery<{
        externalId: string;
        credentialsEncrypted: string | null;
      }>(
        sql`SELECT external_id, credentials_encrypted FROM social_connection_location WHERE connection_id = ${metaConnection} ORDER BY external_id`,
      );
      expect(sealed.every((row) => row.credentialsEncrypted?.startsWith('v1.'))).toBe(
        true,
      );
      expect(JSON.stringify(sealed)).not.toContain('own-page-token');

      // Meta stops accepting the login's user token (its ~60 days are up).
      fake.discover.mockRejectedValueOnce(
        new ProviderError('CONNECTION_REVOKED', 'Authorization expired', {
          reconnectRequired: true,
        }),
      );
      expect(
        (
          await request(app)
            .post(`${company}/${metaConnection}/sync`)
            .set(headers())
            .send({})
        ).status,
      ).toBe(422);
      const [login] = await adminQuery<{ status: string }>(
        sql`SELECT status FROM social_connection WHERE id = ${metaConnection}`,
      );
      expect(login!.status).toBe('reconnect_required');
      const accounts = await clientAccounts(acme);
      expect(accounts.map((item) => item.status)).toEqual(['connected', 'connected']);

      // The Page still publishes, with its own token rather than the expired one.
      const facebook = accounts.find((item) => item.platform === 'facebook')!;
      const instagram = accounts.find((item) => item.platform === 'instagram')!;
      const post = async (accountId: string, caption: string) => {
        const created = await request(app)
          .post(`${workspace(acme)}/posts`)
          .set(headers(owner))
          .send({ caption, accountIds: [accountId], mediaIds: [], intent: 'draft' });
        expect(created.status).toBe(201);
        expect(
          (
            await request(app)
              .post(`${workspace(acme)}/posts/${created.body.data.id}/publish`)
              .set(headers(owner))
              .send({})
          ).status,
        ).toBe(201);
        await runPublishingSweep(jobCtx());
      };
      fake.publish.mockClear();
      fake.publish.mockResolvedValueOnce({ externalPostId: 'fb-post-1' });
      await post(facebook.id, 'Still posting');
      expect(fake.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          account: expect.objectContaining({ platform: 'facebook', externalId: '101' }),
          credentials: expect.objectContaining({ accessToken: 'own-page-token-101' }),
        }),
      );

      // A Page token refused by Meta needs a reconnect for that account only.
      fake.publish.mockRejectedValueOnce(
        new ProviderError('CONNECTION_REVOKED', 'Authorization expired', {
          reconnectRequired: true,
        }),
      );
      await post(instagram.id, 'Refused');
      const after = await clientAccounts(acme);
      expect(after.find((item) => item.platform === 'instagram')!.status).toBe(
        'reconnect_required',
      );
      expect(after.find((item) => item.platform === 'facebook')!.status).toBe(
        'connected',
      );

      // Signing in again heals the login and everything that waited for it.
      const healed = await connect({
        platform: 'facebook',
        sub: '5550001',
        name: 'Riya at Agency A',
        token: 'meta-user-token-2',
        assets: pages(),
      });
      expect(healed.status).toBe(201);
      expect(healed.body.data).toMatchObject({ id: metaConnection, status: 'connected' });
      expect((await clientAccounts(acme)).map((item) => item.status)).toEqual([
        'connected',
        'connected',
      ]);
    });

    it('flags every connection of a Facebook login when one of them revokes its grant', async () => {
      // A client sign-in made with the same Facebook user as the company login.
      fake.exchange.mockResolvedValueOnce({
        accessToken: 'riya-user-token',
        scopes: [],
        metadata: { tokenType: 'user' },
      });
      fake.discover.mockResolvedValueOnce([
        asset('facebook', '999', 'Zen Studio', { tasks: ['CREATE_CONTENT'] }),
      ]);
      fake.identity.mockResolvedValueOnce({
        externalAccountId: '5550001',
        name: 'Riya at Agency A',
      });
      const started = await request(app)
        .post(`${workspace(zen)}/oauth/facebook/start`)
        .set(headers())
        .send({});
      expect(started.status).toBe(201);
      const state = new URL(
        started.body.data.authorizationUrl as string,
      ).searchParams.get('state')!;
      const cookie = (started.headers['set-cookie'] as unknown as string[])[0]!.split(
        ';',
      )[0]!;
      expect(
        (
          await request(app)
            .post(`${workspace(zen)}/oauth/facebook/complete`)
            .set(headers())
            .set('Cookie', cookie)
            .send({ code: 'code', state })
        ).status,
      ).toBe(201);
      const selected = await request(app)
        .post(`${workspace(zen)}/oauth/facebook/select`)
        .set(headers())
        .send({ state, accountIds: ['999'] });
      expect(selected.status).toBe(201);
      const studio = (selected.body.data as { id: string; externalId: string }[]).find(
        (item) => item.externalId === '999',
      )!;
      const [recorded] = await adminQuery<{ externalAccountId: string | null }>(
        sql`SELECT c.external_account_id FROM social_account a JOIN social_connection c ON c.id = a.connection_id WHERE a.id = ${studio.id}`,
      );
      expect(recorded!.externalAccountId).toBe('5550001');

      // Revoking removes the app for the whole Facebook user at Meta.
      fake.revoke.mockResolvedValueOnce(undefined);
      const revoked = await request(app)
        .delete(`${workspace(zen)}/accounts/${studio.id}`)
        .set(headers())
        .send({ revokeGrant: true });
      expect(revoked.status).toBe(200);
      expect(revoked.body.data).toMatchObject({
        revocationStatus: 'revoked',
        othersNeedReconnect: 1,
      });
      const [login] = await adminQuery<{ status: string }>(
        sql`SELECT status FROM social_connection WHERE id = ${metaConnection}`,
      );
      expect(login!.status).toBe('reconnect_required');
      // Pages publishing with their own tokens too: those were read with the same grant.
      expect((await clientAccounts(acme)).map((item) => item.status)).toEqual([
        'reconnect_required',
        'reconnect_required',
      ]);

      const healed = await connect({
        platform: 'facebook',
        sub: '5550001',
        name: 'Riya at Agency A',
        token: 'meta-user-token-3',
        assets: [
          asset('facebook', '101', 'Acme Dental Clinic', { tasks: ['CREATE_CONTENT'] }),
          asset('instagram', '17841', 'Acme Dental', {
            pageId: '101',
            username: 'acmedental',
          }),
          asset('facebook', '102', 'Zen Yoga', { tasks: ['CREATE_CONTENT'] }),
          asset('facebook', '103', 'Corner Bakery', { tasks: ['CREATE_CONTENT'] }),
        ],
      });
      expect(healed.status).toBe(201);
      expect((await clientAccounts(acme)).map((item) => item.status)).toEqual([
        'connected',
        'connected',
      ]);
    });

    it('moves a Page between clients in one step, and never takes a client’s own sign-in', async () => {
      const listed = await locations(metaConnection);
      const page = (externalId: string) =>
        listed.find((item) => item.externalId === externalId)!;
      const bakery = page('103');
      expect((await assign(metaConnection, bakery.id, acme)).status).toBe(200);
      // Without asking for a move, the Page stays where it is.
      expect((await assign(metaConnection, bakery.id, zen)).status).toBe(409);
      const moved = await request(app)
        .put(`${company}/${metaConnection}/locations/${bakery.id}/client`)
        .set(headers())
        .send({ clientId: zen, move: true });
      expect(moved.status).toBe(200);
      expect(moved.body.data.assignment).toMatchObject({
        clientId: zen,
        via: 'company_connection',
      });
      expect(
        (await clientAccounts(acme)).find((item) => item.externalId === '103')!.status,
      ).toBe('disconnected');
      expect(
        (await clientAccounts(zen)).find((item) => item.externalId === '103')!.status,
      ).toBe('connected');
      expect((await assign(metaConnection, bakery.id, null)).status).toBe(200);

      // Zen connected the Zen Yoga Page with its own sign-in: a move cannot take it.
      const [own] = await adminQuery<{ id: string }>(
        sql`INSERT INTO social_connection(organization_id,client_id,platform,credentials_encrypted,created_by) VALUES (${org},${zen},'facebook',NULL,${owner}) RETURNING id`,
      );
      const [ownAccount] = await adminQuery<{ id: string }>(
        sql`INSERT INTO social_account(organization_id,client_id,connection_id,platform,external_id,name) VALUES (${org},${zen},${own!.id},'facebook','102','Zen Yoga') RETURNING id`,
      );
      const refused = await request(app)
        .put(`${company}/${metaConnection}/locations/${page('102').id}/client`)
        .set(headers())
        .send({ clientId: acme, move: true });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/own sign-in/);
      await adminQuery(
        sql`UPDATE social_account SET status = 'disconnected' WHERE id = ${ownAccount!.id}`,
      );
    });

    let googleConnection = '';
    it('lists Search Console properties from a Google login and assigns each to one client', async () => {
      fake.properties.mockResolvedValueOnce([
        { siteUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://www.zenyoga.example/', permissionLevel: 'siteFullUser' },
      ]);
      const connected = await connect({
        platform: 'google_business',
        sub: 'google-agency-1',
        email: 'seo@agency-a.test',
        token: 'google-token-1',
        assets: [],
      });
      expect(connected.status).toBe(201);
      expect(connected.body.data).toMatchObject({ locationCount: 2, lastError: null });
      googleConnection = connected.body.data.id as string;
      const listed = await locations(googleConnection);
      const domain = listed.find(
        (item) => item.externalId === 'sc-domain:acmedental.in',
      )!;
      expect(domain).toMatchObject({
        platform: 'search_console',
        name: 'acmedental.in',
        detail: 'Domain property · Owner',
        websiteUrl: 'https://acmedental.in/',
        suggestion: { clientId: acme, reason: 'website' },
      });
      // No client owns that domain, but its name carries Zen Yoga's.
      expect(
        listed.find((item) => item.externalId === 'https://www.zenyoga.example/'),
      ).toMatchObject({
        name: 'www.zenyoga.example',
        detail: 'URL-prefix property · Full user',
        suggestion: { clientId: zen, reason: 'name' },
      });

      const assigned = await assign(googleConnection, domain.id, acme);
      expect(assigned.status).toBe(200);
      expect(assigned.body.data.assignment).toMatchObject({
        accountId: null,
        clientId: acme,
        clientName: 'Acme Dental',
        via: 'company_connection',
      });
      // A property is read, never published to: it is not a client account.
      expect(
        (await clientAccounts(acme))
          .filter((item) => item.status !== 'disconnected')
          .map((item) => item.platform)
          .sort(),
      ).toEqual(['facebook', 'instagram']);
      // One client per property.
      expect((await assign(googleConnection, domain.id, zen)).status).toBe(409);
      const logins = (await request(app).get(company).set(headers())).body.data as {
        id: string;
        assignedCount: number;
      }[];
      expect(logins.find((item) => item.id === googleConnection)).toMatchObject({
        assignedCount: 1,
      });
      // Another company never sees the property.
      expect(
        (
          await request(app)
            .get(`${company}/${googleConnection}/locations`)
            .set(headers(otherOrg, otherOrg))
        ).status,
      ).toBe(404);
    });

    it('moves a property between two Google logins of the same company without a second client', async () => {
      fake.properties.mockResolvedValueOnce([
        { siteUrl: 'sc-domain:acmedental.in', permissionLevel: 'siteFullUser' },
      ]);
      const second = await connect({
        platform: 'google_business',
        sub: 'google-agency-2',
        email: 'ops@agency-a.test',
        token: 'google-token-2',
        assets: [],
      });
      expect(second.status).toBe(201);
      const secondId = second.body.data.id as string;
      const [row] = await locations(secondId);
      // Already assigned through the first login.
      expect(row).toMatchObject({ assignment: { clientId: acme }, suggestion: null });
      expect((await assign(secondId, row!.id, acme)).status).toBe(200);
      const holders = await adminQuery<{ connectionId: string }>(
        sql`SELECT connection_id FROM social_connection_location WHERE organization_id = ${org} AND external_id = 'sc-domain:acmedental.in' AND client_id IS NOT NULL`,
      );
      expect(holders).toEqual([{ connectionId: secondId }]);
      // Unassigning clears it wherever it is assigned.
      expect((await assign(secondId, row!.id, null)).status).toBe(200);
      expect(
        (await locations(googleConnection)).find(
          (item) =>
            item.platform === 'search_console' &&
            item.externalId === 'sc-domain:acmedental.in',
        )!.assignment,
      ).toBeNull();
    });

    it('keeps the profiles when Search Console cannot be listed, and says why', async () => {
      fake.properties.mockRejectedValueOnce(
        new ProviderError('PLATFORM_PERMISSION_DENIED', 'Denied', { status: 403 }),
      );
      const connected = await connect({
        platform: 'google_business',
        sub: 'google-agency-3',
        email: 'maps@agency-a.test',
        token: 'google-token-3',
        assets: [
          asset('google_business', 'locations/77', 'Acme Dental Bandra', {
            websiteUri: 'https://acmedental.in/',
          }),
        ],
      });
      expect(connected.status).toBe(201);
      expect(connected.body.data.locationCount).toBe(1);
      expect(connected.body.data.lastError).toMatch(
        /Search Console properties could not be listed/,
      );
    });

    it('enforces in the database that only Search Console properties are assigned on their own row', async () => {
      const [page] = await adminQuery<{ id: string }>(
        sql`SELECT id FROM social_connection_location WHERE connection_id = ${metaConnection} AND external_id = '103'`,
      );
      await expect(
        db.query(
          jobCtx(),
          sql`UPDATE social_connection_location SET client_id = ${zen} WHERE organization_id = ${org} AND id = ${page!.id}`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('releases its Search Console properties when a Google login is disconnected', async () => {
      const [domain] = (await locations(googleConnection)).filter(
        (item) => item.externalId === 'sc-domain:acmedental.in',
      );
      expect((await assign(googleConnection, domain!.id, acme)).status).toBe(200);
      const disconnected = await request(app)
        .delete(`${company}/${googleConnection}`)
        .set(headers())
        .send({});
      expect(disconnected.status).toBe(200);
      const remaining = await adminQuery<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM social_connection_location WHERE organization_id = ${org} AND client_id IS NOT NULL`,
      );
      expect(remaining).toEqual([{ count: 0 }]);
    });
  },
);
