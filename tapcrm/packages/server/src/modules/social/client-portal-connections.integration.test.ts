import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import {
  createJobContext,
  createRequestContext,
  systemPrincipal,
} from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { __resetConfig } from '../../config.js';
import { runPublishingSweep } from './jobs.js';
import { getPost } from './service.js';
import { ProviderError } from './providers/types.js';

const ACCESS = 'PLAINTEXT-ACCESS-TOKEN-xyz';
const REFRESH = 'PLAINTEXT-REFRESH-xyz';
const SECRET_NAME = 'Zebra Holdings Secret';

const fake = vi.hoisted(() => ({
  publish: vi.fn(),
  exchange: vi.fn(),
  discover: vi.fn(),
  refresh: vi.fn(),
  insights: vi.fn(),
  revoke: vi.fn(),
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
  return {
    getProviderReadiness: readiness,
    listProviderReadiness: () =>
      ['facebook', 'instagram', 'youtube', 'linkedin', 'google_business'].map(readiness),
    getProvider: (platform: string) => ({
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
      discoverAccounts: fake.discover,
      refreshCredentials: fake.refresh,
      publishPost: fake.publish,
      getAccountInsights: fake.insights,
      revoke: fake.revoke,
    }),
  };
});

const capabilities = {
  publishText: true,
  publishImages: true,
  publishVideo: false,
  accountInsights: true,
  postInsights: false,
};
const discovered = (
  externalId: string,
  name = `Page ${externalId}`,
  platform = 'facebook',
) => ({
  platform,
  externalId,
  name,
  capabilities,
  credentials: {
    accessToken: ACCESS,
    refreshToken: REFRESH,
    scopes: ['pages_manage_posts'],
  },
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)('Client portal social connections through HTTP', () => {
  const org = randomUUID();
  const otherOrg = randomUUID();
  const owner = randomUUID();
  const superAdmin = randomUUID();
  const department = randomUUID();
  const position = randomUUID();
  const client = randomUUID();
  const otherClient = randomUUID();
  const foreignClient = randomUUID();
  const clientUser = randomUUID();
  const clientUserB = randomUUID();
  const otherClientUser = randomUUID();
  const foreignClientUser = randomUUID();
  let app: ReturnType<typeof buildApp>;
  /** Every JSON body the portal returned, for the secrets sweep. */
  const seen: string[] = [];
  const admin = (fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', 'isolated client portal social fixture', fragment);
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
      jobName: 'client-portal-social-test',
      runId: randomUUID(),
    });
  const headers = (userId: string, organizationId = org) => ({
    'x-dev-user-id': userId,
    'x-dev-organization-id': organizationId,
  });
  const portal = (clientId = client) => `/api/social/portal/clients/${clientId}`;
  const agency = (clientId = client) => `/api/social/clients/${clientId}`;
  const call = (method: 'get' | 'post' | 'delete', path: string) => {
    const agent = request(app);
    return method === 'get'
      ? agent.get(path)
      : method === 'post'
        ? agent.post(path)
        : agent.delete(path);
  };
  const record = <T extends { body: unknown }>(res: T): T => {
    seen.push(JSON.stringify(res.body));
    return res;
  };
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    (res.headers['set-cookie'] as string[])[0]!.split(';')[0]!;
  const stateOf = (res: { body: { data: { authorizationUrl: string } } }) =>
    new URL(res.body.data.authorizationUrl).searchParams.get('state')!;

  async function portalStart(
    platform = 'facebook',
    user = clientUser,
    clientId = client,
  ) {
    const res = record(
      await request(app)
        .post(`${portal(clientId)}/oauth/${platform}/start`)
        .set(headers(user))
        .send({}),
    );
    return res;
  }
  async function portalComplete(
    state: string,
    cookie: string,
    platform = 'facebook',
    user = clientUser,
  ) {
    return record(
      await request(app)
        .post(`${portal()}/oauth/${platform}/complete`)
        .set(headers(user))
        .set('Cookie', cookie)
        .send({ code: 'code', state }),
    );
  }
  async function portalSelect(
    state: string,
    accountIds: string[],
    platform = 'facebook',
    user = clientUser,
  ) {
    return record(
      await request(app)
        .post(`${portal()}/oauth/${platform}/select`)
        .set(headers(user))
        .send({ state, accountIds }),
    );
  }
  /** Start, complete and select as the client; returns the select response. */
  async function connectAsClient(
    accounts: ReturnType<typeof discovered>[],
    selected: string[],
    platform = 'facebook',
  ) {
    fake.discover.mockResolvedValueOnce(accounts);
    const started = await portalStart(platform);
    expect(started.status).toBe(201);
    const state = stateOf(started);
    const completed = await portalComplete(state, cookieOf(started), platform);
    expect(completed.status).toBe(201);
    const selection = await portalSelect(state, selected, platform);
    expect(selection.status).toBe(201);
    return selection;
  }
  async function agencyStartComplete(accounts: ReturnType<typeof discovered>[]) {
    fake.discover.mockResolvedValueOnce(accounts);
    const started = await request(app)
      .post(`${agency()}/oauth/facebook/start`)
      .set(headers(owner))
      .send({});
    expect(started.status).toBe(201);
    const state = stateOf(started);
    const completed = await request(app)
      .post(`${agency()}/oauth/facebook/complete`)
      .set(headers(owner))
      .set('Cookie', cookieOf(started))
      .send({ code: 'code', state });
    return { started, state, completed };
  }
  async function accountRow(externalId: string) {
    const rows = (await admin(
      sql`SELECT a.id, a.status, a.client_id, c.connected_via, c.created_by, c.credentials_encrypted, c.status AS connection_status
        FROM social_account a JOIN social_connection c ON c.id = a.connection_id
        WHERE a.organization_id = ${org} AND a.external_id = ${externalId}`,
    )) as {
      id: string;
      status: string;
      clientId: string;
      connectedVia: string;
      createdBy: string;
      credentialsEncrypted: string | null;
      connectionStatus: string;
    }[];
    return rows[0];
  }

  beforeAll(async () => {
    if (!new URL(process.env['MIGRATION_DATABASE_URL'] ?? '').pathname.includes('test'))
      throw new Error('Refusing client portal fixtures outside a test database');
    vi.stubEnv('IDENTITY_DEV_BYPASS', 'true');
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
    __resetConfig();
    await admin(
      sql`INSERT INTO organization(id,code,name) VALUES (${org},${`portal-${org.slice(0, 8)}`},'Portal Test'),(${otherOrg},${`pother-${otherOrg.slice(0, 8)}`},'Other')`,
    );
    await admin(
      sql`INSERT INTO department(id,organization_id,code,name,kind) VALUES (${department},${org},'SOCIAL','Social','support')`,
    );
    await admin(
      sql`INSERT INTO position(id,organization_id,department_id,code,name,organizational_level) VALUES (${position},${org},${department},'SOCIAL','Social',10)`,
    );
    await admin(sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status,department_id,position_id,employee_id)
      VALUES (${owner},${org},'employee',${`${org}-owner@portal-test.invalid`},'Owner','active',${department},${position},${owner.toUpperCase()})`);
    await admin(
      sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status) VALUES (${superAdmin},${org},'super-admin',${`${org}-admin@portal-test.invalid`},'Admin','active'),(${otherOrg},${otherOrg},'super-admin',${`${otherOrg}@portal-test.invalid`},'Foreign','active')`,
    );
    for (const [id, organizationId, clientName, businessName] of [
      [client, org, 'Own Contact', 'Own Business'],
      [otherClient, org, 'Zebra Contact', SECRET_NAME],
      [foreignClient, otherOrg, 'Foreign Contact', 'Foreign Business'],
    ] as const) {
      await admin(
        sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${id},${organizationId},${clientName},${businessName},${`${id}@portal-test.invalid`},'in','INR','Asia/Kolkata',${organizationId === org ? owner : otherOrg})`,
      );
    }
    for (const [id, organizationId, clientId] of [
      [clientUser, org, client],
      [clientUserB, org, client],
      [otherClientUser, org, otherClient],
      [foreignClientUser, otherOrg, foreignClient],
    ] as const) {
      await admin(
        sql`INSERT INTO app_user(id,organization_id,account_type,client_id,email,full_name,status) VALUES (${id},${organizationId},'client',${clientId},${`${id}@portal-test.invalid`},'Client login','active')`,
      );
    }
    for (const organizationId of [org, otherOrg])
      await admin(
        sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${organizationId},id FROM module WHERE key IN ('social','client-portal')`,
      );
    await admin(
      sql`INSERT INTO position_policy(organization_id,position_id,action,allowed,scope) SELECT ${org},${position},action,true,'own' FROM registry_action WHERE module = 'social' AND action <> 'social:connect-own-accounts'`,
    );
    app = buildApp();
    fake.exchange.mockResolvedValue({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      scopes: ['pages_manage_posts'],
    });
    fake.publish.mockImplementation(async () => ({
      externalPostId: `remote-${randomUUID()}`,
      url: 'https://platform.test/post',
    }));
    fake.revoke.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await closePools();
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    fake.revoke.mockClear();
    fake.revoke.mockResolvedValue(undefined);
  });

  it('connects only the explicitly chosen account for the client', async () => {
    const accounts = [
      discovered('pg-happy-1', 'Happy One'),
      discovered('pg-happy-2', 'Happy Two'),
      discovered('pg-happy-3', 'Happy Three'),
    ];
    fake.discover.mockResolvedValueOnce(accounts);
    const started = await portalStart();
    expect(started.status).toBe(201);
    const authorization = new URL(started.body.data.authorizationUrl as string);
    expect(authorization.origin).toBe('https://provider.test');
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    const cookie = cookieOf(started);
    expect(cookie).toMatch(/^tapcrm_social_oauth=/);
    const state = stateOf(started);

    // The browser cookie is required.
    expect((await portalComplete(state, 'tapcrm_social_oauth=wrong')).status).toBe(422);
    const completed = await portalComplete(state, cookie);
    expect(completed.status).toBe(201);
    const candidates = completed.body.data.candidates as {
      externalId: string;
      availability: string;
    }[];
    expect(candidates.map((c) => c.externalId).sort()).toEqual([
      'pg-happy-1',
      'pg-happy-2',
      'pg-happy-3',
    ]);
    expect(candidates.every((c) => c.availability === 'available')).toBe(true);

    // Nothing is attached until the client chooses.
    expect(await accountRow('pg-happy-1')).toBeUndefined();
    expect((await portalSelect(state, [])).status).toBe(422);
    expect((await portalSelect(state, ['not-a-candidate'])).status).toBe(422);
    expect((await portalSelect(state, ['pg-happy-1', 'not-a-candidate'])).status).toBe(
      422,
    );
    expect(await accountRow('pg-happy-1')).toBeUndefined();

    const selected = await portalSelect(state, ['pg-happy-1']);
    expect(selected.status).toBe(201);
    const listed = selected.body.data.accounts as {
      name: string;
      managedBy: string;
      status: string;
    }[];
    expect(listed.map((a) => a.name)).toEqual(['Happy One']);
    expect(listed[0]!.managedBy).toBe('client');

    const overview = record(
      await request(app).get(`${portal()}/connections`).set(headers(clientUser)),
    );
    expect(overview.status).toBe(200);
    expect(overview.body.data.accounts).toHaveLength(1);
    const row = (await accountRow('pg-happy-1'))!;
    expect(row.connectedVia).toBe('client_portal');
    expect(row.createdBy).toBe(clientUser);
    expect(row.clientId).toBe(client);
    expect(await accountRow('pg-happy-2')).toBeUndefined();
    expect(await accountRow('pg-happy-3')).toBeUndefined();
    // Single use.
    expect((await portalSelect(state, ['pg-happy-2'])).status).toBe(422);
  });

  it('keeps every portal route to the client’s own login', async () => {
    const routes: ['get' | 'post' | 'delete', string, object][] = [
      ['get', '/connections', {}],
      ['post', '/oauth/facebook/start', {}],
      ['post', '/oauth/facebook/complete', { code: 'c', state: 's' }],
      ['post', '/oauth/facebook/select', { state: 's', accountIds: ['x'] }],
      ['delete', `/accounts/${randomUUID()}`, {}],
    ];
    // Another client of the same organization, and a client of another organization.
    for (const [clientId, user, userOrg] of [
      [otherClient, clientUser, org],
      [foreignClient, clientUser, org],
      [client, otherClientUser, org],
      [client, foreignClientUser, otherOrg],
    ] as const)
      for (const [method, path, body] of routes) {
        const res = await call(method, `${portal(clientId)}${path}`)
          .set(headers(user, userOrg))
          .send(body);
        expect(res.status, `${method} ${path} for ${clientId} by ${user}`).toBe(404);
      }

    // Staff are refused, whatever their rights in the agency workspace.
    for (const user of [owner, superAdmin])
      for (const [method, path, body] of routes) {
        const res = await call(method, `${portal()}${path}`)
          .set(headers(user))
          .send(body);
        expect(res.status, `${method} ${path} by ${user}`).toBe(403);
      }
    expect((await request(app).get(`${portal()}/connections`)).status).toBe(401);

    // A client login holds no agency-side connection, publishing or company rights.
    const asClient = headers(clientUser);
    const refused = [
      await request(app).post(`${agency()}/oauth/facebook/start`).set(asClient).send({}),
      await request(app)
        .post(`${agency()}/posts`)
        .set(asClient)
        .send({ caption: 'x', accountIds: [], mediaIds: [], intent: 'draft' }),
      await request(app)
        .post(`${agency()}/posts/${randomUUID()}/publish`)
        .set(asClient)
        .send({}),
      await request(app)
        .put(`${agency()}/settings`)
        .set(asClient)
        .send({ timezone: 'Asia/Kolkata', approvalRequired: false }),
      await request(app).get('/api/social/company-connections').set(asClient),
      await request(app)
        .delete(`${agency()}/accounts/${randomUUID()}`)
        .set(asClient)
        .send({ revokeGrant: true }),
    ];
    for (const res of refused) expect([403, 404]).toContain(res.status);
  });

  it('refuses a state started by another login, or one whose session changed', async () => {
    fake.discover.mockResolvedValue([discovered('pg-session')]);
    const started = await portalStart('facebook', clientUser);
    const state = stateOf(started);
    // A second login of the same client cannot finish the first one's sign-in.
    const stolen = await portalComplete(
      state,
      cookieOf(started),
      'facebook',
      clientUserB,
    );
    expect(stolen.status).toBe(422);
    expect(
      (await portalSelect(state, ['pg-session'], 'facebook', clientUserB)).status,
    ).toBe(422);
    // A different client's login cannot even reach the route.
    const foreign = await request(app)
      .post(`${portal()}/oauth/facebook/complete`)
      .set(headers(otherClientUser))
      .set('Cookie', cookieOf(started))
      .send({ code: 'code', state });
    expect(foreign.status).toBe(404);

    const second = await portalStart('facebook', clientUserB);
    await admin(
      sql`UPDATE app_user SET session_version = session_version + 1 WHERE id = ${clientUserB}`,
    );
    const stale = await portalComplete(
      stateOf(second),
      cookieOf(second),
      'facebook',
      clientUserB,
    );
    expect(stale.status).toBe(422);
    expect(await accountRow('pg-session')).toBeUndefined();
  });

  it('rejects replayed, foreign-browser, expired and mismatched OAuth states', async () => {
    fake.discover.mockResolvedValue([discovered('pg-state')]);
    // Replay.
    const first = await portalStart();
    const firstState = stateOf(first);
    expect((await portalComplete(firstState, cookieOf(first))).status).toBe(201);
    expect((await portalComplete(firstState, cookieOf(first))).status).toBe(422);

    // Missing and another sign-in's cookie.
    const second = await portalStart();
    const other = await portalStart();
    expect(
      (
        await request(app)
          .post(`${portal()}/oauth/facebook/complete`)
          .set(headers(clientUser))
          .send({ code: 'code', state: stateOf(second) })
      ).status,
    ).toBe(422);
    expect((await portalComplete(stateOf(second), cookieOf(other))).status).toBe(422);

    // Expired in the database.
    await admin(
      sql`UPDATE social_oauth_state SET expires_at = now() - interval '1 minute' WHERE organization_id = ${org} AND consumed_at IS NULL`,
    );
    expect((await portalComplete(stateOf(second), cookieOf(second))).status).toBe(422);

    // Platform mismatch.
    const facebook = await portalStart('facebook');
    expect(
      (await portalComplete(stateOf(facebook), cookieOf(facebook), 'instagram')).status,
    ).toBe(422);

    // Selection is only open once the sign-in returned.
    const unfinished = await portalStart();
    expect((await portalSelect(stateOf(unfinished), ['pg-state'])).status).toBe(422);
  });

  it('tells the client what to do when the platform refuses the sign-in', async () => {
    // Permissions switched off on the consent screen: nothing is attached.
    fake.exchange.mockRejectedValueOnce(
      new ProviderError(
        'OAUTH_PERMISSIONS_MISSING',
        'Required publishing permissions were not granted. Reconnect and grant the requested permissions.',
      ),
    );
    const declined = await portalStart('instagram');
    const refused = await portalComplete(
      stateOf(declined),
      cookieOf(declined),
      'instagram',
    );
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('SOCIAL_OAUTH_PERMISSIONS_MISSING');
    // Any other platform refusal: a client-facing message, not the agency's setup advice.
    fake.exchange.mockRejectedValueOnce(
      new ProviderError(
        'PLATFORM_PERMISSION_DENIED',
        'The platform denied access. Check app approval, account role, and granted permissions.',
      ),
    );
    const denied = await portalStart('facebook');
    const failed = await portalComplete(stateOf(denied), cookieOf(denied));
    expect(failed.status).toBe(422);
    expect(failed.body.code).toBe('SOCIAL_OAUTH_FAILED');
    expect(failed.body.message).not.toMatch(/app approval/i);
    // The agency still sees the provider's own explanation, as before.
    fake.exchange.mockRejectedValueOnce(
      new ProviderError(
        'PLATFORM_PERMISSION_DENIED',
        'The platform denied access. Check app approval, account role, and granted permissions.',
      ),
    );
    const agencyStarted = await request(app)
      .post(`${agency()}/oauth/facebook/start`)
      .set(headers(owner))
      .send({});
    const agencySide = await request(app)
      .post(`${agency()}/oauth/facebook/complete`)
      .set(headers(owner))
      .set('Cookie', cookieOf(agencyStarted))
      .send({ code: 'code', state: stateOf(agencyStarted) });
    expect(agencySide.status).toBe(422);
    expect(agencySide.body.code).toBe('PLATFORM_PERMISSION_DENIED');
  });

  it('keeps agency and client-portal sign-ins apart', async () => {
    fake.discover.mockResolvedValue([discovered('pg-surface')]);
    const agencyStart = await request(app)
      .post(`${agency()}/oauth/facebook/start`)
      .set(headers(owner))
      .send({});
    expect(agencyStart.status).toBe(201);
    const agencyState = stateOf(agencyStart);
    const stored = (await admin(
      sql`SELECT surface FROM social_oauth_state WHERE organization_id = ${org} AND created_by = ${owner} ORDER BY created_at DESC LIMIT 1`,
    )) as { surface: string }[];
    expect(stored[0]!.surface).toBe('workspace');

    // An agency state cannot be completed or selected on the portal routes.
    const asClient = await portalComplete(agencyState, cookieOf(agencyStart));
    expect(asClient.status).toBe(422);
    const asClientSelect = await portalSelect(agencyState, ['pg-surface']);
    expect(asClientSelect.status).toBe(422);

    const portalStarted = await portalStart();
    const portalState = stateOf(portalStarted);
    const row = (await admin(
      sql`SELECT surface, created_by FROM social_oauth_state WHERE organization_id = ${org} AND created_by = ${clientUser} ORDER BY created_at DESC LIMIT 1`,
    )) as { surface: string; createdBy: string }[];
    expect(row[0]).toMatchObject({ surface: 'client_portal', createdBy: clientUser });
    // A portal state cannot be completed on the agency routes, by staff or by the client.
    const byStaff = await request(app)
      .post(`${agency()}/oauth/facebook/complete`)
      .set(headers(owner))
      .set('Cookie', cookieOf(portalStarted))
      .send({ code: 'code', state: portalState });
    expect(byStaff.status).toBe(422);
    const byClient = await request(app)
      .post(`${agency()}/oauth/facebook/complete`)
      .set(headers(clientUser))
      .set('Cookie', cookieOf(portalStarted))
      .send({ code: 'code', state: portalState });
    expect([403, 404]).toContain(byClient.status);
    expect(await accountRow('pg-surface')).toBeUndefined();

    // The fixed callback sends each to its own screen.
    const toPortal = await request(app)
      .get(
        `/api/social/oauth/facebook/callback?${new URLSearchParams({ code: 'code', state: portalState }).toString()}`,
      )
      .set('Cookie', cookieOf(portalStarted));
    expect(toPortal.status).toBe(303);
    expect(toPortal.headers['location']).toMatch(
      /^http:\/\/localhost:5173\/client\/social#social-oauth=/,
    );
    const toAgency = await request(app)
      .get(
        `/api/social/oauth/facebook/callback?${new URLSearchParams({ code: 'code', state: agencyState }).toString()}`,
      )
      .set('Cookie', cookieOf(agencyStart));
    expect(toAgency.status).toBe(303);
    expect(toAgency.headers['location']).toMatch(
      /^http:\/\/localhost:5173\/company\/social#social-oauth=/,
    );
    const denied = await request(app)
      .get(
        `/api/social/oauth/facebook/callback?${new URLSearchParams({ error: 'access_denied', state: portalState }).toString()}`,
      )
      .set('Cookie', cookieOf(portalStarted));
    expect(denied.status).toBe(303);
    const location = new URL(denied.headers['location'] as string);
    expect(location.pathname).toBe('/client/social');
    const payload = JSON.parse(
      decodeURIComponent(location.hash.replace('#social-oauth=', '')),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      error: 'SOCIAL_OAUTH_DENIED',
      platform: 'facebook',
      clientId: client,
    });
    expect(payload['code']).toBeUndefined();
    // Without the browser cookie the callback is refused.
    expect(
      (
        await request(app).get(
          `/api/social/oauth/facebook/callback?${new URLSearchParams({ code: 'code', state: portalState }).toString()}`,
        )
      ).status,
    ).toBe(400);
  });

  it('lists the platforms, and keeps Google Business Profile and LinkedIn off the portal', async () => {
    const overview = await request(app)
      .get(`${portal()}/connections`)
      .set(headers(clientUser));
    expect(overview.status).toBe(200);
    const providers = overview.body.data.providers as {
      platform: string;
      status: string;
      requirements: string[];
    }[];
    expect(providers.map((p) => p.platform)).toEqual([
      'facebook',
      'instagram',
      'youtube',
      'google_business',
    ]);
    expect(providers.find((p) => p.platform === 'google_business')!.status).toBe(
      'unavailable',
    );
    expect(providers.find((p) => p.platform === 'facebook')!.status).toBe('ready');
    expect(
      providers.find((p) => p.platform === 'facebook')!.requirements.length,
    ).toBeGreaterThan(0);
    const google = await portalStart('google_business');
    expect(google.status).toBe(422);
    expect(google.body.code).toBe('SOCIAL_SETUP_REQUIRED');
    const linkedin = await portalStart('linkedin');
    expect(linkedin.status).toBe(422);
    expect(linkedin.body.code).toBe('SOCIAL_PORTAL_UNSUPPORTED');
    const complete = await portalComplete('abc', 'tapcrm_social_oauth=x', 'linkedin');
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('SOCIAL_PORTAL_UNSUPPORTED');
  });

  it('tells availability without naming another client, and never takes over', async () => {
    // Another client already publishes to this Page.
    const [theirs] = (await admin(
      sql`INSERT INTO social_connection(organization_id,client_id,platform,credentials_encrypted,created_by) VALUES (${org},${otherClient},'facebook',NULL,${owner}) RETURNING id`,
    )) as { id: string }[];
    await admin(
      sql`INSERT INTO social_account(organization_id,client_id,connection_id,platform,external_id,name) VALUES (${org},${otherClient},${theirs!.id},'facebook','pg-taken','Taken Page')`,
    );
    // The agency already manages this one for this client.
    const agencySide = await agencyStartComplete([
      discovered('pg-agency', 'Agency Page'),
    ]);
    expect(agencySide.completed.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`${agency()}/oauth/facebook/select`)
          .set(headers(owner))
          .send({ state: agencySide.state, accountIds: ['pg-agency'] })
      ).status,
    ).toBe(201);
    // The client connected this one itself.
    await connectAsClient([discovered('pg-own', 'Own Page')], ['pg-own']);
    const ownBefore = (await accountRow('pg-own'))!;

    fake.discover.mockResolvedValueOnce([
      discovered('pg-taken', 'Taken Page'),
      discovered('pg-agency', 'Agency Page'),
      discovered('pg-own', 'Own Page'),
      discovered('pg-free', 'Free Page'),
    ]);
    const started = await portalStart();
    const state = stateOf(started);
    const completed = await portalComplete(state, cookieOf(started));
    expect(completed.status).toBe(201);
    const availability = Object.fromEntries(
      (
        completed.body.data.candidates as { externalId: string; availability: string }[]
      ).map((c) => [c.externalId, c.availability]),
    );
    expect(availability).toEqual({
      'pg-taken': 'unavailable',
      'pg-agency': 'managed_by_agency',
      'pg-own': 'reconnect',
      'pg-free': 'available',
    });
    expect(completed.text).not.toContain('Zebra');
    expect(completed.text).not.toContain(otherClient);

    for (const blocked of ['pg-taken', 'pg-agency']) {
      const refused = await portalSelect(state, [blocked]);
      expect(refused.status, blocked).toBe(409);
      expect(refused.text).not.toContain('Zebra');
      expect(refused.text).not.toContain(otherClient);
    }
    expect((await accountRow('pg-taken'))!.clientId).toBe(otherClient);
    expect((await accountRow('pg-agency'))!.connectedVia).toBe('agency');

    // The refused attempts did not use the sign-in up; reconnecting renews the same account.
    const renewed = await portalSelect(state, ['pg-own']);
    expect(renewed.status).toBe(201);
    const ownAfter = (await accountRow('pg-own'))!;
    expect(ownAfter.id).toBe(ownBefore.id);
    expect(ownAfter.connectedVia).toBe('client_portal');
    expect(ownAfter.status).toBe('connected');
    expect(
      (renewed.body.data.accounts as { name: string }[]).filter(
        (a) => a.name === 'Own Page',
      ),
    ).toHaveLength(1);
    // The agency's account shows to the client as the agency's.
    const overview = (
      renewed.body.data.accounts as { name: string; managedBy: string }[]
    ).find((a) => a.name === 'Agency Page');
    expect(overview?.managedBy).toBe('agency');

    // The agency cannot silently take over what the client connected.
    fake.discover.mockResolvedValueOnce([discovered('pg-own', 'Own Page')]);
    const employeeStart = await request(app)
      .post(`${agency()}/oauth/facebook/start`)
      .set(headers(owner))
      .send({});
    const employeeState = stateOf(employeeStart);
    const employeeComplete = await request(app)
      .post(`${agency()}/oauth/facebook/complete`)
      .set(headers(owner))
      .set('Cookie', cookieOf(employeeStart))
      .send({ code: 'code', state: employeeState });
    expect(employeeComplete.status).toBe(201);
    expect(employeeComplete.body.data.candidates[0].assignedTo).toMatchObject({
      viaClientPortal: true,
    });
    const takeover = await request(app)
      .post(`${agency()}/oauth/facebook/select`)
      .set(headers(owner))
      .send({ state: employeeState, accountIds: ['pg-own'] });
    expect(takeover.status).toBe(409);
    expect((await accountRow('pg-own'))!.connectedVia).toBe('client_portal');
  });

  it('shows the agency the client’s accounts, lets it draft posts, and leaves the client’s grant alone', async () => {
    await connectAsClient([discovered('pg-visible', 'Visible Page')], ['pg-visible']);
    const row = (await accountRow('pg-visible'))!;
    const listed = await request(app).get(`${agency()}/accounts`).set(headers(owner));
    expect(listed.status).toBe(200);
    const account = (listed.body.data as { id: string; connectionOrigin: string }[]).find(
      (a) => a.id === row.id,
    );
    expect(account?.connectionOrigin).toBe('client_portal');
    expect(JSON.stringify(listed.body)).not.toContain(ACCESS);

    const draft = await request(app)
      .post(`${agency()}/posts`)
      .set(headers(owner))
      .send({
        caption: 'Agency draft',
        accountIds: [row.id],
        mediaIds: [],
        intent: 'draft',
      });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('draft');

    const refused = await request(app)
      .delete(`${agency()}/accounts/${row.id}`)
      .set(headers(owner))
      .send({ revokeGrant: true });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('SOCIAL_CLIENT_OWNED_GRANT');
    expect(fake.revoke).not.toHaveBeenCalled();
    expect((await accountRow('pg-visible'))!.status).toBe('connected');

    const removed = await request(app)
      .delete(`${agency()}/accounts/${row.id}`)
      .set(headers(owner))
      .send({});
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({
      disconnected: true,
      revocationStatus: 'not_requested',
    });
    expect(fake.revoke).not.toHaveBeenCalled();
    const after = (await accountRow('pg-visible'))!;
    expect(after.status).toBe('disconnected');
    expect(after.credentialsEncrypted).toBeNull();
    // The client still sees it, to reconnect.
    const overview = await request(app)
      .get(`${portal()}/connections`)
      .set(headers(clientUser));
    expect(
      (overview.body.data.accounts as { name: string; status: string }[]).find(
        (a) => a.name === 'Visible Page',
      )?.status,
    ).toBe('disconnected');
  });

  it('cancels scheduled posts when the client disconnects, and leaves agency accounts alone', async () => {
    await connectAsClient([discovered('pg-sched', 'Scheduled Page')], ['pg-sched']);
    const row = (await accountRow('pg-sched'))!;
    const caption = `scheduled-${randomUUID()}`;
    const created = await request(app)
      .post(`${agency()}/posts`)
      .set(headers(owner))
      .send({ caption, accountIds: [row.id], mediaIds: [], intent: 'draft' });
    expect(created.status).toBe(201);
    const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await request(app)
      .post(`${agency()}/posts/${created.body.data.id}/publish`)
      .set(headers(owner))
      .send({ scheduledAt });
    expect(scheduled.body.data.status).toBe('scheduled');

    const removed = record(
      await request(app)
        .delete(`${portal()}/accounts/${row.id}`)
        .set(headers(clientUser))
        .send({}),
    );
    expect(removed.status).toBe(200);
    expect(removed.body.data.disconnected).toBe(true);
    expect(removed.body.data.cancelledScheduledPosts).toBeGreaterThanOrEqual(1);
    expect(removed.body.data.revocationStatus).toBe('not_requested');
    const post = await getPost(ownerCtx(), client, created.body.data.id as string);
    expect(post.destinations.map((d) => d.status)).toEqual(['cancelled']);
    expect((await accountRow('pg-sched'))!.credentialsEncrypted).toBeNull();

    await runPublishingSweep(jobCtx(), new Date(Date.now() + 2 * 3_600_000));
    const published = fake.publish.mock.calls.filter(
      ([input]) =>
        (input as { content?: { caption?: string } }).content?.caption === caption,
    );
    expect(published).toHaveLength(0);

    // The agency's own account is not the client's to remove.
    const agencyAccount = await (async () => {
      const side = await agencyStartComplete([
        discovered('pg-agency-del', 'Agency Delete'),
      ]);
      await request(app)
        .post(`${agency()}/oauth/facebook/select`)
        .set(headers(owner))
        .send({ state: side.state, accountIds: ['pg-agency-del'] });
      return (await accountRow('pg-agency-del'))!;
    })();
    for (const revokeGrant of [false, true]) {
      const denied = record(
        await request(app)
          .delete(`${portal()}/accounts/${agencyAccount.id}`)
          .set(headers(clientUser))
          .send({ revokeGrant }),
      );
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('SOCIAL_AGENCY_MANAGED');
    }
    expect((await accountRow('pg-agency-del'))!.status).toBe('connected');
    expect(fake.revoke).not.toHaveBeenCalled();
    // An account that does not exist, or belongs to another client, is not found.
    expect(
      (
        await request(app)
          .delete(`${portal()}/accounts/${randomUUID()}`)
          .set(headers(clientUser))
          .send({})
      ).status,
    ).toBe(404);
  });

  it('revokes the platform permission only when asked, and reports a failed revoke safely', async () => {
    await connectAsClient([discovered('pg-revoke', 'Revoke Page')], ['pg-revoke']);
    const row = (await accountRow('pg-revoke'))!;
    const revoked = record(
      await request(app)
        .delete(`${portal()}/accounts/${row.id}`)
        .set(headers(clientUser))
        .send({ revokeGrant: true }),
    );
    expect(revoked.status).toBe(200);
    expect(fake.revoke).toHaveBeenCalledTimes(1);
    expect(fake.revoke.mock.calls[0]![0]).toMatchObject({ accessToken: ACCESS });
    expect(revoked.body.data).toMatchObject({
      disconnected: true,
      revocationStatus: 'revoked',
    });
    expect((await accountRow('pg-revoke'))!.status).toBe('disconnected');

    await connectAsClient(
      [discovered('pg-revoke-fail', 'Failing Page')],
      ['pg-revoke-fail'],
    );
    const failing = (await accountRow('pg-revoke-fail'))!;
    fake.revoke.mockRejectedValueOnce(new Error(`platform said no for ${ACCESS}`));
    const failed = record(
      await request(app)
        .delete(`${portal()}/accounts/${failing.id}`)
        .set(headers(clientUser))
        .send({ revokeGrant: true }),
    );
    expect(failed.status).toBe(200);
    expect(failed.body.data).toMatchObject({
      disconnected: true,
      revocationStatus: 'remove_access_in_platform_settings',
    });
    expect(failed.text).not.toContain(ACCESS);
    const gone = (await accountRow('pg-revoke-fail'))!;
    expect(gone.status).toBe('disconnected');
    expect(gone.credentialsEncrypted).toBeNull();
  });

  it('never exposes or stores tokens in plaintext', async () => {
    const accounts = [discovered('pg-secret-1', 'Secret One'), discovered('pg-secret-2')];
    fake.discover.mockResolvedValueOnce(accounts);
    const started = await portalStart();
    const completed = await portalComplete(stateOf(started), cookieOf(started));
    const selected = await portalSelect(stateOf(started), ['pg-secret-1']);
    const overview = record(
      await request(app).get(`${portal()}/connections`).set(headers(clientUser)),
    );
    const id = (await accountRow('pg-secret-1'))!.id;
    const removed = record(
      await request(app)
        .delete(`${portal()}/accounts/${id}`)
        .set(headers(clientUser))
        .send({ revokeGrant: true }),
    );
    for (const res of [started, completed, selected, overview, removed]) {
      expect(res.status).toBeLessThan(300);
      expect(res.text).not.toContain(ACCESS);
      expect(res.text).not.toContain(REFRESH);
      expect(res.text).not.toContain('pages_manage_posts');
    }
    for (const body of seen) {
      expect(body).not.toContain(ACCESS);
      expect(body).not.toContain(REFRESH);
    }
    const audit = (await admin(
      sql`SELECT details::text AS details FROM social_audit_log WHERE organization_id = ${org}`,
    )) as { details: string }[];
    expect(audit.length).toBeGreaterThan(0);
    for (const entry of audit) {
      expect(entry.details).not.toContain(ACCESS);
      expect(entry.details).not.toContain(REFRESH);
    }
    const states = (await admin(
      sql`SELECT to_jsonb(s)::text AS dump FROM social_oauth_state s WHERE organization_id = ${org}`,
    )) as { dump: string }[];
    for (const state of states) {
      expect(state.dump).not.toContain(ACCESS);
      expect(state.dump).not.toContain(REFRESH);
    }
    const connections = (await admin(
      sql`SELECT credentials_encrypted FROM social_connection WHERE organization_id = ${org} AND credentials_encrypted IS NOT NULL`,
    )) as { credentialsEncrypted: string }[];
    expect(connections.length).toBeGreaterThan(0);
    for (const connection of connections) {
      expect(connection.credentialsEncrypted).not.toContain(ACCESS);
      expect(connection.credentialsEncrypted).not.toContain(REFRESH);
    }
  });

  it('guards origin and surface in the database', async () => {
    const insertConnection = (createdBy: string, clientId: string | null, via: string) =>
      admin(
        sql`INSERT INTO social_connection(organization_id,client_id,platform,credentials_encrypted,created_by,connected_via) VALUES (${org},${clientId},'facebook',NULL,${createdBy},${via}) RETURNING id`,
      );
    await expect(insertConnection(owner, client, 'client_portal')).rejects.toThrow();
    await expect(
      insertConnection(otherClientUser, client, 'client_portal'),
    ).rejects.toThrow();
    await expect(insertConnection(clientUser, null, 'client_portal')).rejects.toThrow();
    await expect(insertConnection(clientUser, client, 'bogus')).rejects.toThrow();
    // The same insert as the application role is refused too.
    await expect(
      db.query(
        ownerCtx(),
        sql`INSERT INTO social_connection(organization_id,client_id,platform,credentials_encrypted,created_by,connected_via) VALUES (${org},${client},'facebook',NULL,${owner},'client_portal')`,
      ),
    ).rejects.toThrow();

    const [good] = (await insertConnection(clientUser, client, 'client_portal')) as {
      id: string;
    }[];
    await expect(
      admin(
        sql`UPDATE social_connection SET connected_via = 'agency' WHERE id = ${good!.id}`,
      ),
    ).rejects.toThrow();
    const [agencyRow] = (await insertConnection(owner, client, 'agency')) as {
      id: string;
    }[];
    await expect(
      admin(
        sql`UPDATE social_connection SET connected_via = 'client_portal' WHERE id = ${agencyRow!.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      admin(
        sql`UPDATE social_connection SET created_by = ${owner} WHERE id = ${good!.id}`,
      ),
    ).rejects.toThrow();

    const insertState = (createdBy: string, clientId: string | null, surface: string) =>
      admin(
        sql`INSERT INTO social_oauth_state(organization_id,client_id,state_hash,platform,created_by,verifier_encrypted,expires_at,surface) VALUES (${org},${clientId},${randomUUID()},'facebook',${createdBy},'x',now() + interval '10 minutes',${surface}) RETURNING state_hash`,
      );
    await expect(insertState(owner, client, 'client_portal')).rejects.toThrow();
    await expect(insertState(otherClientUser, client, 'client_portal')).rejects.toThrow();
    await expect(insertState(clientUser, null, 'client_portal')).rejects.toThrow();
    await expect(insertState(owner, client, 'bogus')).rejects.toThrow();
    const [state] = (await insertState(owner, client, 'workspace')) as {
      stateHash: string;
    }[];
    await expect(
      admin(
        sql`UPDATE social_oauth_state SET surface = 'client_portal' WHERE state_hash = ${state!.stateHash}`,
      ),
    ).rejects.toThrow();
    await expect(insertState(clientUser, client, 'client_portal')).resolves.toBeDefined();
  });
});
