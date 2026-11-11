import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { __resetConfig } from '../../config.js';
import {
  createJobContext,
  createRequestContext,
  systemPrincipal,
} from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  __resetStorageService,
  __setStorageService,
} from '../../platform/storage/index.js';
import { runPublishingSweep } from './jobs.js';
import { ProviderError } from './providers/types.js';
import { saveConnectionAccounts } from './service.js';

const fake = vi.hoisted(() => ({
  exchange: vi.fn(),
  identity: vi.fn(),
  discover: vi.fn(),
  refresh: vi.fn(),
  publish: vi.fn(),
  revoke: vi.fn(),
  insights: vi.fn(),
  properties: vi.fn(async () => []),
}));
vi.mock('./providers/index.js', () => {
  const capabilities = {
    publishText: true,
    publishImages: true,
    publishVideo: false,
    accountInsights: true,
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
    getAccountInsights: fake.insights,
    listSearchConsoleProperties: fake.properties,
  });
  return {
    getProviderReadiness: readiness,
    listProviderReadiness: () => ['google_business', 'facebook'].map(readiness),
    getProvider: provider,
    getCompanyProvider: provider,
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)('Company-wide Google Business Profile connections', () => {
  const org = randomUUID();
  const otherOrg = randomUUID();
  const owner = randomUUID();
  const admin = randomUUID();
  const department = randomUUID();
  const position = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  let app: ReturnType<typeof buildApp>;
  let connectionId = '';
  const locationIds: Record<string, string> = {};
  const capabilities = {
    publishText: true,
    publishImages: true,
    publishVideo: false,
    accountInsights: true,
    postInsights: false,
  };
  const adminQuery = <T>(fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', 'isolated company connection fixture', fragment);
  const ownerCtx = () =>
    createRequestContext({
      organizationId: org,
      principal: {
        id: owner,
        organizationId: org,
        accountType: 'employee',
        sessionVersion: 0,
        positionId: position,
        departmentId: department,
        teamId: null,
        reportsTo: null,
        organizationalLevel: 1,
      },
      requestId: randomUUID(),
    });
  const jobCtx = () =>
    createJobContext({
      organizationId: org,
      principal: systemPrincipal(org),
      jobName: 'social-company-test',
      runId: randomUUID(),
    });
  const headers = (userId = admin, organizationId = org) => ({
    'x-dev-user-id': userId,
    'x-dev-organization-id': organizationId,
  });
  const company = '/api/social/company-connections';
  const workspace = (clientId: string) => `/api/social/clients/${clientId}`;
  const location = (id: string, name: string) => ({
    platform: 'google_business',
    externalId: `locations/${id}`,
    name,
    capabilities,
    credentials: { accessToken: 'discovery-copy', scopes: [] },
    metadata: {
      accountName: 'accounts/1',
      locationName: `locations/${id}`,
      address: `${id} Hill Road, Mumbai`,
      websiteUri: 'https://cafe.example.com',
      mapsUri: 'javascript:alert(1)',
    },
  });
  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/business.manage',
  ];

  /** The full browser round trip: start, Google's redirect back, completion. */
  async function connect(input: {
    sub: string;
    email: string;
    token: string;
    expiresAt?: string;
    locations: ReturnType<typeof location>[];
  }) {
    fake.exchange.mockResolvedValueOnce({
      accessToken: input.token,
      refreshToken: `refresh-${input.sub}`,
      expiresAt: input.expiresAt ?? '2099-01-01T00:00:00Z',
      scopes,
    });
    fake.identity.mockResolvedValueOnce({
      externalAccountId: input.sub,
      email: input.email,
    });
    fake.discover.mockResolvedValueOnce(input.locations);
    const started = await request(app)
      .post(`${company}/oauth/google_business/start`)
      .set(headers())
      .send({});
    expect(started.status).toBe(201);
    const state = new URL(started.body.data.authorizationUrl as string).searchParams.get(
      'state',
    )!;
    const cookie = (started.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!;
    const callback = await request(app)
      .get(
        `/api/social/oauth/google_business/callback?${new URLSearchParams({ code: 'code', state }).toString()}`,
      )
      .set('Cookie', cookie);
    expect(callback.status).toBe(303);
    const destination = callback.headers['location'] as string;
    expect(destination).toMatch(
      /^http:\/\/localhost:5173\/company\/social\/connections#social-oauth=/,
    );
    const payload = JSON.parse(
      decodeURIComponent(destination.split('#social-oauth=')[1]!),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      scope: 'company',
      clientId: null,
      platform: 'google_business',
    });
    return request(app)
      .post(`${company}/oauth/google_business/complete`)
      .set(headers())
      .set('Cookie', cookie)
      .send({ code: payload['code'], state: payload['state'] });
  }
  async function listLocations() {
    const response = await request(app)
      .get(`${company}/${connectionId}/locations`)
      .set(headers());
    expect(response.status).toBe(200);
    return response.body.data as {
      id: string;
      externalId: string;
      name: string;
      status: string;
      address: string | null;
      mapsUrl: string | null;
      websiteUrl: string | null;
      assignment: { clientId: string; accountId: string; via: string } | null;
    }[];
  }
  async function clientAccounts(clientId: string) {
    const response = await request(app)
      .get(`${workspace(clientId)}/accounts`)
      .set(headers(owner));
    expect(response.status).toBe(200);
    return response.body.data as {
      id: string;
      externalId: string;
      status: string;
      connectionScope: string;
    }[];
  }
  async function connection() {
    const [row] = await adminQuery<{
      status: string;
      credentialsEncrypted: string | null;
      clientId: string | null;
      externalAccountId: string;
    }>(
      sql`SELECT status, credentials_encrypted, client_id, external_account_id FROM social_connection WHERE id = ${connectionId}`,
    );
    return row!;
  }
  async function publish(
    clientId: string,
    accountId: string,
    caption: string,
    at?: string,
  ) {
    const created = await request(app)
      .post(`${workspace(clientId)}/posts`)
      .set(headers(owner))
      .send({ caption, accountIds: [accountId], mediaIds: [], intent: 'draft' });
    expect(created.status).toBe(201);
    const published = await request(app)
      .post(`${workspace(clientId)}/posts/${created.body.data.id}/publish`)
      .set(headers(owner))
      .send(at ? { scheduledAt: at } : {});
    expect(published.status).toBe(201);
    return created.body.data.id as string;
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
      throw new Error('Refusing company connection fixtures outside a test database');
    vi.stubEnv('IDENTITY_DEV_BYPASS', 'true');
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'cd'.repeat(32));
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
    __resetConfig();
    await adminQuery(
      sql`INSERT INTO organization(id,code,name) VALUES (${org},${`gbp-${org.slice(0, 8)}`},'Agency A'),(${otherOrg},${`gbp-${otherOrg.slice(0, 8)}`},'Agency B')`,
    );
    await adminQuery(
      sql`INSERT INTO department(id,organization_id,code,name,kind) VALUES (${department},${org},'SOCIAL','Social','support')`,
    );
    await adminQuery(
      sql`INSERT INTO position(id,organization_id,department_id,code,name,organizational_level) VALUES (${position},${org},${department},'SOCIAL','Social',10)`,
    );
    for (const [id, type, email, fullName] of [
      [owner, 'employee', 'owner@gbp-test.invalid', 'Social Manager'],
      [admin, 'super-admin', 'admin@gbp-test.invalid', 'Company Admin'],
    ] as const) {
      await adminQuery(sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status,department_id,position_id,employee_id)
        VALUES (${id},${org},${type},${`${org}-${email}`},${fullName},'active',${type === 'employee' ? department : null},${type === 'employee' ? position : null},${id.toUpperCase()})`);
    }
    await adminQuery(
      sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status) VALUES (${otherOrg},${otherOrg},'super-admin',${`${otherOrg}@gbp-test.invalid`},'Other Admin','active')`,
    );
    for (const [id, name] of [
      [clientA, 'Green Cafe'],
      [clientB, 'Blue Salon'],
    ] as const) {
      await adminQuery(
        sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${id},${org},${name},${name},${`${id}@gbp-test.invalid`},'in','INR','Asia/Kolkata',${owner})`,
      );
    }
    for (const organizationId of [org, otherOrg])
      await adminQuery(
        sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${organizationId},id FROM module WHERE key = 'social'`,
      );
    // The social manager holds every social action, but not company integrations.
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

  it('lets only integration managers manage company connections', async () => {
    expect((await request(app).get(company)).status).toBe(401);
    expect((await request(app).get(company).set(headers(owner))).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`${company}/oauth/google_business/start`)
          .set(headers(owner))
          .send({})
      ).status,
    ).toBe(403);
    const listed = await request(app).get(company).set(headers());
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([]);
    // Only platforms that support a company sign-in are accepted. Instagram is
    // connected through the company's Facebook login, never on its own.
    expect(
      (
        await request(app)
          .post(`${company}/oauth/instagram/start`)
          .set(headers())
          .send({})
      ).status,
    ).toBe(422);
  });

  it('connects a Google account once, lists its locations and recognises the same account on reconnect', async () => {
    const first = await connect({
      sub: 'google-user-1',
      email: 'agency@company-a.test',
      token: 'company-token-1',
      locations: [
        location('1', 'Green Cafe Bandra'),
        location('2', 'Blue Salon Andheri'),
      ],
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      platform: 'google_business',
      accountEmail: 'agency@company-a.test',
      status: 'connected',
      locationCount: 2,
      assignedCount: 0,
      connectedByName: 'Company Admin',
    });
    expect(JSON.stringify(first.body)).not.toContain('company-token-1');
    connectionId = first.body.data.id as string;
    const stored = await connection();
    expect(stored).toMatchObject({
      status: 'connected',
      clientId: null,
      externalAccountId: 'google-user-1',
    });
    expect(stored.credentialsEncrypted).toBeTruthy();
    expect(stored.credentialsEncrypted).not.toContain('company-token-1');

    const listed = await listLocations();
    expect(listed.map((item) => [item.externalId, item.status])).toEqual([
      ['locations/2', 'available'],
      ['locations/1', 'available'],
    ]);
    expect(listed[1]).toMatchObject({
      name: 'Green Cafe Bandra',
      address: '1 Hill Road, Mumbai',
      websiteUrl: 'https://cafe.example.com/',
      // A non-web link from the platform never reaches the browser.
      mapsUrl: null,
      assignment: null,
    });

    // Same Google account again: same row, fresh list (2 left, 3 joined).
    const again = await connect({
      sub: 'google-user-1',
      email: 'agency@company-a.test',
      token: 'company-token-2',
      locations: [location('1', 'Green Cafe Bandra'), location('3', 'Blue Salon Powai')],
    });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(connectionId);
    expect((await request(app).get(company).set(headers())).body.data).toHaveLength(1);
    const refreshed = await listLocations();
    expect(
      Object.fromEntries(refreshed.map((item) => [item.externalId, item.status])),
    ).toEqual({
      'locations/1': 'available',
      'locations/2': 'missing',
      'locations/3': 'available',
    });
    for (const item of refreshed) locationIds[item.externalId] = item.id;

    // Another company never sees this connection.
    const foreign = await request(app).get(company).set(headers(otherOrg, otherOrg));
    expect(foreign.status).toBe(200);
    expect(foreign.body.data).toEqual([]);
    expect(
      (
        await request(app)
          .get(`${company}/${connectionId}/locations`)
          .set(headers(otherOrg, otherOrg))
      ).status,
    ).toBe(404);
  });

  it('assigns each location to one client and publishes with one shared, once-refreshed token', async () => {
    const assign = (externalId: string, clientId: string | null) =>
      request(app)
        .put(`${company}/${connectionId}/locations/${locationIds[externalId]}/client`)
        .set(headers())
        .send({ clientId });
    const assigned = await assign('locations/1', clientA);
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.assignment).toMatchObject({
      clientId: clientA,
      clientName: 'Green Cafe',
      status: 'connected',
      via: 'company_connection',
    });
    expect((await assign('locations/1', clientB)).status).toBe(409);
    expect((await assign('locations/2', clientB)).status).toBe(422);
    expect((await assign('locations/3', clientB)).status).toBe(200);
    // Assigning again to the same client changes nothing.
    expect((await assign('locations/1', clientA)).status).toBe(200);

    const [accountA] = await clientAccounts(clientA);
    const [accountB] = await clientAccounts(clientB);
    expect(accountA).toMatchObject({
      externalId: 'locations/1',
      status: 'connected',
      connectionScope: 'company',
    });
    expect(accountB).toMatchObject({
      externalId: 'locations/3',
      connectionScope: 'company',
    });

    // An expiring company token is refreshed once and then shared by both clients.
    await connect({
      sub: 'google-user-1',
      email: 'agency@company-a.test',
      token: 'company-token-expiring',
      expiresAt: '2026-01-01T00:00:00Z',
      locations: [location('1', 'Green Cafe Bandra'), location('3', 'Blue Salon Powai')],
    });
    fake.refresh.mockResolvedValue({
      accessToken: 'company-token-refreshed',
      refreshToken: 'refresh-google-user-1',
      expiresAt: '2099-01-01T00:00:00Z',
      scopes,
    });
    fake.publish.mockImplementation(async () => ({
      externalPostId: `accounts/1/locations/x/localPosts/${randomUUID()}`,
      url: 'https://business.google.com/post',
    }));
    const postA = await publish(clientA, accountA!.id, 'Monsoon menu is live');
    const postB = await publish(clientB, accountB!.id, 'Bridal offers this week');
    await runPublishingSweep(jobCtx());
    expect(fake.refresh).toHaveBeenCalledTimes(1);
    expect(fake.publish).toHaveBeenCalledTimes(2);
    for (const [call] of fake.publish.mock.calls as [
      { credentials: { accessToken: string }; account: { externalId: string } },
    ][])
      expect(call.credentials.accessToken).toBe('company-token-refreshed');
    for (const [clientId, postId] of [
      [clientA, postA],
      [clientB, postB],
    ] as const) {
      const detail = await request(app)
        .get(`${workspace(clientId)}/posts/${postId}`)
        .set(headers(owner));
      expect(detail.body.data.status).toBe('published');
    }
  });

  it('marks every location of a revoked company sign-in for reconnect, tells admins once, and heals on reconnect', async () => {
    const [accountA] = await clientAccounts(clientA);
    fake.publish.mockRejectedValueOnce(
      new ProviderError('CONNECTION_REVOKED', 'Reconnect the account', {
        reconnectRequired: true,
      }),
    );
    await publish(clientA, accountA!.id, 'This one hits a revoked grant');
    await runPublishingSweep(jobCtx());
    expect((await connection()).status).toBe('reconnect_required');
    expect((await clientAccounts(clientA))[0]!.status).toBe('reconnect_required');
    expect((await clientAccounts(clientB))[0]!.status).toBe('reconnect_required');
    const notices = () =>
      adminQuery<{ type: string; link: string }>(
        sql`SELECT payload->>'type' AS type, payload->>'link' AS link FROM notification_outbox WHERE organization_id = ${org} AND payload->>'type' = 'social.connection_reconnect_required'`,
      );
    expect(await notices()).toEqual([
      {
        type: 'social.connection_reconnect_required',
        link: '/company/social/connections',
      },
    ]);
    // Refreshing a connection that needs a reconnect is refused.
    expect(
      (await request(app).post(`${company}/${connectionId}/sync`).set(headers()).send({}))
        .status,
    ).toBe(409);
    // A failure noticed again does not notify again.
    const { markAccountError, getAccountConnection } = await import('./service.js');
    await markAccountError(
      jobCtx(),
      await getAccountConnection(
        ownerCtx(),
        clientB,
        (await clientAccounts(clientB))[0]!.id,
      ),
      'Still revoked',
      true,
    );
    expect(await notices()).toHaveLength(1);

    const healed = await connect({
      sub: 'google-user-1',
      email: 'agency@company-a.test',
      token: 'company-token-3',
      locations: [location('1', 'Green Cafe Bandra'), location('3', 'Blue Salon Powai')],
    });
    expect(healed.body.data.status).toBe('connected');
    expect((await clientAccounts(clientA))[0]!.status).toBe('connected');
    expect((await clientAccounts(clientB))[0]!.status).toBe('connected');
  });

  it('unassigns from the client page without touching the company sign-in', async () => {
    const [accountA] = await clientAccounts(clientA);
    const refused = await request(app)
      .delete(`${workspace(clientA)}/accounts/${accountA!.id}`)
      .set(headers(owner))
      .send({ revokeGrant: true });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('SOCIAL_COMPANY_CONNECTION');
    expect(fake.revoke).not.toHaveBeenCalled();

    const scheduled = await publish(
      clientA,
      accountA!.id,
      'Scheduled before the unassignment',
      '2099-06-01T10:00:00+05:30',
    );
    const removed = await request(app)
      .delete(`${workspace(clientA)}/accounts/${accountA!.id}`)
      .set(headers(owner))
      .send({});
    expect(removed.status).toBe(200);
    expect((await clientAccounts(clientA))[0]!.status).toBe('disconnected');
    const detail = await request(app)
      .get(`${workspace(clientA)}/posts/${scheduled}`)
      .set(headers(owner));
    expect(detail.body.data.status).toBe('cancelled');
    const stored = await connection();
    expect(stored.status).toBe('connected');
    expect(stored.credentialsEncrypted).toBeTruthy();
    const listed = await listLocations();
    expect(
      listed.find((item) => item.externalId === 'locations/1')?.assignment,
    ).toBeNull();
  });

  it("moves a client's own sign-in for the same location onto the company connection, keeping its history", async () => {
    // A location the company already serves to client B cannot be signed in for client A.
    await expect(
      saveConnectionAccounts(ownerCtx(), clientA, [
        {
          ...location('3', 'Blue Salon Powai'),
          credentials: { accessToken: 'client-own-token', scopes: [] },
        } as never,
      ]),
    ).rejects.toMatchObject({ status: 409 });

    const own = await saveConnectionAccounts(ownerCtx(), clientA, [
      {
        ...location('1', 'Green Cafe Bandra'),
        credentials: { accessToken: 'client-own-token', scopes: [] },
      } as never,
    ]);
    const legacy = own.find((item) => item.externalId === 'locations/1')!;
    expect(legacy).toMatchObject({ status: 'connected', connectionScope: 'client' });
    const [before] = await adminQuery<{ connectionId: string }>(
      sql`SELECT connection_id FROM social_account WHERE id = ${legacy.id}`,
    );
    const listed = await listLocations();
    expect(
      listed.find((item) => item.externalId === 'locations/1')?.assignment,
    ).toMatchObject({ clientId: clientA, via: 'client_connection' });

    const moved = await request(app)
      .put(`${company}/${connectionId}/locations/${locationIds['locations/1']}/client`)
      .set(headers())
      .send({ clientId: clientA });
    expect(moved.status).toBe(200);
    expect(moved.body.data.assignment).toMatchObject({
      accountId: legacy.id,
      via: 'company_connection',
    });
    const [after] = await clientAccounts(clientA);
    expect(after).toMatchObject({ id: legacy.id, connectionScope: 'company' });
    const [retired] = await adminQuery<{
      status: string;
      credentialsEncrypted: string | null;
    }>(
      sql`SELECT status, credentials_encrypted FROM social_connection WHERE id = ${before!.connectionId}`,
    );
    expect(retired).toEqual({ status: 'disconnected', credentialsEncrypted: null });
  });

  it('enforces connection scope in the database, not only in the service', async () => {
    const [clientConnection] = await adminQuery<{ id: string }>(
      sql`SELECT id FROM social_connection WHERE organization_id = ${org} AND client_id = ${clientA} LIMIT 1`,
    );
    await expect(
      db.query(
        ownerCtx(),
        sql`INSERT INTO social_account(organization_id,client_id,connection_id,platform,external_id,name) VALUES (${org},${clientB},${connectionId},'google_business','locations/99','No location')`,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(
        /company connection serves a client through one of its locations/,
      ),
    });
    await expect(
      db.query(
        ownerCtx(),
        sql`INSERT INTO social_account(organization_id,client_id,connection_id,platform,external_id,name) VALUES (${org},${clientB},${clientConnection!.id},'google_business','locations/98','Other client')`,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/client connection serves only its own client/),
    });
    await expect(
      db.query(
        ownerCtx(),
        sql`UPDATE social_connection SET client_id = ${clientA} WHERE organization_id = ${org} AND id = ${connectionId}`,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/keeps the scope it was created with/),
    });
    // A location can only hang off a company-wide connection.
    await expect(
      db.query(
        ownerCtx(),
        sql`INSERT INTO social_connection_location(organization_id,connection_id,platform,external_id,name) VALUES (${org},${clientConnection!.id},'google_business','locations/97','Wrong owner')`,
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/belong to a company-wide connection/),
    });
  });

  it('disconnects the company sign-in: unassigns every location, cancels scheduled posts and can revoke', async () => {
    const [accountB] = await clientAccounts(clientB);
    const scheduled = await publish(
      clientB,
      accountB!.id,
      'Scheduled before the disconnection',
      '2099-06-01T10:00:00+05:30',
    );
    fake.revoke.mockResolvedValueOnce(undefined);
    const disconnected = await request(app)
      .delete(`${company}/${connectionId}`)
      .set(headers())
      .send({ revokeGrant: true });
    expect(disconnected.status).toBe(200);
    expect(disconnected.body.data).toEqual({
      disconnected: true,
      revocationStatus: 'revoked',
    });
    expect(fake.revoke).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'company-token-3' }),
    );
    expect(await connection()).toMatchObject({
      status: 'disconnected',
      credentialsEncrypted: null,
    });
    expect((await clientAccounts(clientA))[0]!.status).toBe('disconnected');
    expect((await clientAccounts(clientB))[0]!.status).toBe('disconnected');
    const detail = await request(app)
      .get(`${workspace(clientB)}/posts/${scheduled}`)
      .set(headers(owner));
    expect(detail.body.data.status).toBe('cancelled');
    expect((await request(app).get(company).set(headers())).body.data).toEqual([]);
  });
});
