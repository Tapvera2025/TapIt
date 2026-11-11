import sharp from 'sharp';
import {
  __setStorageService,
  __resetStorageService,
} from '../../platform/storage/index.js';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import {
  createRequestContext,
  createJobContext,
  systemPrincipal,
} from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { __resetConfig } from '../../config.js';
import { claimDestination, dueDestinations, expireLeases } from './repository.js';
import { getPost, saveConnectionAccounts } from './service.js';
import { runPublishingSweep } from './jobs.js';
import { ProviderError } from './providers/types.js';

const fake = vi.hoisted(() => ({
  publish: vi.fn(),
  exchange: vi.fn(),
  discover: vi.fn(),
  refresh: vi.fn(),
  insights: vi.fn(),
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
    listProviderReadiness: () => ['facebook', 'linkedin'].map(readiness),
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
    }),
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)('Social module through HTTP and restricted PostgreSQL', () => {
  const org = randomUUID();
  const otherOrg = randomUUID();
  const owner = randomUUID();
  const reviewer = randomUUID();
  const outsider = randomUUID();
  const department = randomUUID();
  const position = randomUUID();
  const client = randomUUID();
  const otherClient = randomUUID();
  const foreignClient = randomUUID();
  const clientUser = randomUUID();
  let app: ReturnType<typeof buildApp>;
  let accountId: string;
  let secondAccountId: string;
  const admin = (fragment: ReturnType<typeof sql>) =>
    platformDb.query('migration', 'isolated social integration fixture', fragment);
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
      jobName: 'social-test',
      runId: randomUUID(),
    });
  function headers(userId = owner, organizationId = org) {
    return { 'x-dev-user-id': userId, 'x-dev-organization-id': organizationId };
  }
  const base = () => `/api/social/clients/${client}`;
  const content = (caption: string, accountIds = [accountId]) => ({
    caption,
    accountIds,
    mediaIds: [],
    intent: 'draft',
  });
  const capabilities = {
    publishText: true,
    publishImages: false,
    publishVideo: false,
    accountInsights: true,
    postInsights: false,
  };
  beforeAll(async () => {
    const objects = new Map<
      string,
      { body: Buffer; contentType: string; checksumSha256: string }
    >();
    __setStorageService({
      async putObject({ key, body, contentType }) {
        const checksumSha256 = createHash('sha256').update(body).digest('hex');
        objects.set(key, { body, contentType, checksumSha256 });
        return { checksumSha256 };
      },
      async getObject({ key }) {
        const object = objects.get(key);
        if (!object) throw new Error('Missing test object');
        return { key, ...object };
      },
      async headObject({ key }) {
        const object = objects.get(key)!;
        return {
          checksumSha256: object.checksumSha256,
          contentLength: object.body.length,
        };
      },
      async deleteObject({ key }) {
        objects.delete(key);
      },
      presignedGetUrl({ key }) {
        return `https://files.example.com/${key}`;
      },
    });
    if (!new URL(process.env['MIGRATION_DATABASE_URL'] ?? '').pathname.includes('test'))
      throw new Error('Refusing social fixtures outside a test database');
    vi.stubEnv('IDENTITY_DEV_BYPASS', 'true');
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', 'ab'.repeat(32));
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
    __resetConfig();
    await admin(
      sql`INSERT INTO organization(id,code,name) VALUES (${org},${`social-${org.slice(0, 8)}`},'Social Test'),(${otherOrg},${`other-${otherOrg.slice(0, 8)}`},'Other')`,
    );
    await admin(
      sql`INSERT INTO department(id,organization_id,code,name,kind) VALUES (${department},${org},'SOCIAL','Social','support')`,
    );
    await admin(
      sql`INSERT INTO position(id,organization_id,department_id,code,name,organizational_level) VALUES (${position},${org},${department},'SOCIAL','Social',10)`,
    );
    for (const [id, type, email, fullName] of [
      [owner, 'employee', 'owner@social-test.invalid', 'Owner'],
      [outsider, 'employee', 'outsider@social-test.invalid', 'Outsider'],
      [reviewer, 'super-admin', 'reviewer@social-test.invalid', 'Reviewer'],
    ] as const) {
      await admin(sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status,department_id,position_id,employee_id)
        VALUES (${id},${org},${type},${`${org}-${email}`},${fullName},'active',${type === 'employee' ? department : null},${type === 'employee' ? position : null},${id.toUpperCase()})`);
    }
    await admin(
      sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status) VALUES (${otherOrg},${otherOrg},'super-admin',${`${otherOrg}@social-test.invalid`},'Foreign','active')`,
    );
    for (const [id, organizationId, creator] of [
      [client, org, owner],
      [otherClient, org, outsider],
      [foreignClient, otherOrg, otherOrg],
    ] as const) {
      await admin(
        sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${id},${organizationId},'Client',${id},${`${id}@social-test.invalid`},'in','INR','Asia/Kolkata',${creator})`,
      );
    }
    await admin(
      sql`INSERT INTO app_user(id,organization_id,account_type,client_id,email,full_name,status) VALUES (${clientUser},${org},'client',${client},${`${clientUser}@social-test.invalid`},'Client reviewer','active')`,
    );
    await admin(
      sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${org},id FROM module WHERE key = 'social'`,
    );
    await admin(
      sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${otherOrg},id FROM module WHERE key = 'social'`,
    );
    await admin(
      sql`INSERT INTO position_policy(organization_id,position_id,action,allowed,scope) SELECT ${org},${position},action,true,'own' FROM registry_action WHERE module = 'social'`,
    );
    app = buildApp();
    const accounts = await saveConnectionAccounts(ownerCtx(), client, [
      {
        platform: 'facebook',
        externalId: 'page-a',
        name: 'Page A',
        capabilities,
        credentials: { accessToken: 'private-social-token', scopes: [] },
      },
      {
        platform: 'linkedin',
        externalId: 'org-b',
        name: 'LinkedIn B',
        capabilities,
        credentials: { accessToken: 'private-linkedin-token', scopes: [] },
      },
    ]);
    accountId = accounts.find((a) => a.platform === 'facebook')!.id;
    secondAccountId = accounts.find((a) => a.platform === 'linkedin')!.id;
    fake.publish.mockImplementation(
      async ({ content: post }: { content: { caption: string } }) => {
        if (post.caption === 'fail')
          throw new ProviderError('POST_INVALID', 'Platform rejected this content');
        if (post.caption === 'rate')
          throw new ProviderError('PLATFORM_RATE_LIMITED', 'Retry later', {
            transient: true,
            retryAfter: 60,
          });
        if (post.caption === 'revoked')
          throw new ProviderError('CONNECTION_REVOKED', 'Reconnect the account', {
            reconnectRequired: true,
          });
        return {
          externalPostId: `remote-${randomUUID()}`,
          url: 'https://platform.test/post',
        };
      },
    );
    fake.insights.mockResolvedValue({
      source: 'facebook',
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-14T00:00:00Z',
      metrics: { followers: 42 },
      note: 'Native platform count',
    });
  });
  afterAll(async () => {
    __resetStorageService();
    await closePools();
    vi.unstubAllEnvs();
  });

  it('enforces authentication, client scope, tenant scope and secret-free account DTOs', async () => {
    expect((await request(app).get(`${base()}/accounts`)).status).toBe(401);
    expect(
      (await request(app).get(`${base()}/accounts`).set(headers(outsider))).status,
    ).toBe(403);
    expect(
      (await request(app).get(`${base()}/accounts`).set(headers(otherOrg, otherOrg)))
        .status,
    ).toBe(404);
    const response = await request(app).get(`${base()}/accounts`).set(headers());
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('private-social-token');
    const clients = await request(app).get('/api/social/clients').set(headers());
    expect(
      (clients.body.data.items as { id: string }[]).map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual([client]);
    const rows = await db.query<{ id: string }>(
      ownerCtx(),
      sql`SELECT id FROM client WHERE id = ${foreignClient}`,
    );
    expect(rows).toHaveLength(0);
    const flags = await admin(
      sql`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname LIKE 'social_%' AND relkind = 'r'`,
    );
    expect(flags.length).toBeGreaterThan(10);
    expect(
      flags.every(
        (r) =>
          (r as { relrowsecurity: boolean; relforcerowsecurity: boolean })
            .relrowsecurity &&
          (r as { relforcerowsecurity: boolean }).relforcerowsecurity,
      ),
    ).toBe(true);
  });
  it('creates drafts, rejects cross-client accounts/media and supports client-zone date filters', async () => {
    const draft = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send(content('Draft one'));
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('draft');
    expect(
      (
        await request(app)
          .get(`/api/social/clients/${otherClient}/posts/${draft.body.data.id}`)
          .set(headers(reviewer))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/social/clients/${otherClient}/posts`)
          .set(headers(reviewer))
          .send(content('Cross-client'))
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post(`${base()}/posts`)
          .set(headers())
          .send({ ...content('Bad media'), mediaIds: [randomUUID()] })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .get(`${base()}/posts?from=2026-10-01&to=2026-10-31`)
          .set(headers())
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`${base()}/posts`)
          .set(headers())
          .send({ ...content('Cannot smuggle'), intent: 'publish' })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${draft.body.data.id}/actions`)
          .set(headers())
          .send({ action: 'approve' })
      ).status,
    ).toBe(422);
  });
  it('requires independent approvals, records review history, and opts existing client login into its own workspace', async () => {
    expect(
      (
        await request(app).put(`${base()}/settings`).set(headers(reviewer)).send({
          timezone: 'Asia/Kolkata',
          approvalRequired: true,
          clientReviewEnabled: true,
        })
      ).status,
    ).toBe(200);
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send(content('Review me'));
    const id = created.body.data.id as string;
    expect(
      (await request(app).post(`${base()}/posts/${id}/publish`).set(headers()).send({}))
        .status,
    ).toBe(422);
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${id}/actions`)
          .set(headers())
          .send({ action: 'submit' })
      ).body.data.status,
    ).toBe('pending_approval');
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${id}/review`)
          .set(headers())
          .send({ decision: 'approve' })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get(`${base()}/posts`).set(headers(clientUser))).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/social/clients/${otherClient}/posts`)
          .set(headers(clientUser))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${id}/review`)
          .set(headers(clientUser))
          .send({ decision: 'request_changes', comment: 'Please revise' })
      ).body.data.status,
    ).toBe('draft');
    await request(app)
      .post(`${base()}/posts/${id}/actions`)
      .set(headers())
      .send({ action: 'submit' });
    const approved = await request(app)
      .post(`${base()}/posts/${id}/review`)
      .set(headers(reviewer))
      .send({ decision: 'approve', comment: 'Approved' });
    expect(approved.body.data.approvals).toHaveLength(4);
    expect(approved.body.data.status).toBe('approved');
    const edited = await request(app)
      .patch(`${base()}/posts/${id}`)
      .set(headers())
      .send(content('Changed'));
    expect(edited.body.data.approvedAt).toBeNull();
    expect(edited.body.data.status).toBe('draft');
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${id}/publish`)
          .set(headers(clientUser))
          .send({})
      ).status,
    ).toBe(403);
    await request(app).put(`${base()}/settings`).set(headers(reviewer)).send({
      timezone: 'Asia/Kolkata',
      approvalRequired: false,
      clientReviewEnabled: false,
    });
  });
  it('publishes separate destinations, preserves partial failures and never resends successful destinations', async () => {
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send({
        ...content('success', [accountId, secondAccountId]),
        overrides: { [secondAccountId]: { caption: 'fail' } },
      });
    const id = created.body.data.id as string;
    expect(
      (await request(app).post(`${base()}/posts/${id}/publish`).set(headers()).send({}))
        .body.data.status,
    ).toBe('scheduled');
    const before = fake.publish.mock.calls.length;
    await runPublishingSweep(jobCtx());
    await runPublishingSweep(jobCtx());
    expect(fake.publish.mock.calls.length - before).toBe(2);
    const post = await getPost(ownerCtx(), client, id);
    expect(post.status).toBe('partially_published');
    expect(post.destinations.map((d) => d.status).sort()).toEqual([
      'failed',
      'published',
    ]);
  });
  it('claims one destination under contention, persists restart uncertainty, reschedules and cancels without publishing', async () => {
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send(content('Crash test'));
    const id = created.body.data.id as string;
    await request(app).post(`${base()}/posts/${id}/publish`).set(headers()).send({});
    const due = (await dueDestinations(jobCtx(), new Date())).find(
      (d) => d.postId === id,
    )!;
    const claims = await Promise.all([
      claimDestination(jobCtx(), due, randomUUID(), new Date()),
      claimDestination(jobCtx(), due, randomUUID(), new Date()),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expireLeases(jobCtx(), new Date(Date.now() + 11 * 60_000));
    expect((await getPost(ownerCtx(), client, id)).destinations[0]?.status).toBe(
      'outcome_unknown',
    );
    const next = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send(content('Future'));
    const later = new Date(Date.now() + 86_400_000).toISOString();
    const scheduled = await request(app)
      .post(`${base()}/posts/${next.body.data.id}/publish`)
      .set(headers())
      .send({ scheduledAt: later });
    expect(scheduled.body.data.scheduledAt).toBe(later);
    const newer = new Date(Date.now() + 172_800_000).toISOString();
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${next.body.data.id}/publish`)
          .set(headers())
          .send({ scheduledAt: newer })
      ).body.data.scheduledAt,
    ).toBe(newer);
    expect(
      (
        await request(app)
          .post(`${base()}/posts/${next.body.data.id}/actions`)
          .set(headers())
          .send({ action: 'cancel' })
      ).body.data.status,
    ).toBe('cancelled');
  });
  it('honors publish permission changes after scheduling and stores safe rate-limit retries', async () => {
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send(content('rate'));
    const id = created.body.data.id as string;
    await request(app).post(`${base()}/posts/${id}/publish`).set(headers()).send({});
    await runPublishingSweep(jobCtx());
    const retry = await getPost(ownerCtx(), client, id);
    expect(retry.destinations[0]?.status).toBe('scheduled');
    expect(retry.destinations[0]?.attempts).toBe(1);
    await admin(
      sql`UPDATE position_policy SET allowed = false WHERE organization_id = ${org} AND position_id = ${position} AND action = 'social:publish'`,
    );
    expect(
      (await request(app).post(`${base()}/posts/${id}/publish`).set(headers()).send({}))
        .status,
    ).toBe(403);
    await runPublishingSweep(jobCtx(), new Date(Date.now() + 120_000));
    expect((await getPost(ownerCtx(), client, id)).status).toBe('failed');
    await admin(
      sql`UPDATE position_policy SET allowed = true WHERE organization_id = ${org} AND position_id = ${position} AND action = 'social:publish'`,
    );
  });
  it('validates browser-bound single-use OAuth, selects only requested accounts and preserves IDs when reconnecting', async () => {
    fake.exchange.mockResolvedValue({ accessToken: 'oauth-private-token', scopes: [] });
    fake.discover.mockResolvedValue([
      {
        platform: 'facebook',
        externalId: 'page-a',
        name: 'Page A Reconnected',
        capabilities,
        credentials: { accessToken: 'oauth-private-token', scopes: [] },
      },
      {
        platform: 'facebook',
        externalId: 'not-selected',
        name: 'Another business',
        capabilities,
        credentials: { accessToken: 'other-token', scopes: [] },
      },
    ]);
    const started = await request(app)
      .post(`${base()}/oauth/facebook/start`)
      .set(headers())
      .send({});
    expect(started.status).toBe(201);
    const authorization = new URL(started.body.data.authorizationUrl as string);
    const state = authorization.searchParams.get('state')!;
    expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
    const cookies = started.headers['set-cookie'] as unknown as string[];
    const cookie = cookies[0]!.split(';')[0]!;
    expect(
      (
        await request(app)
          .post(`${base()}/oauth/facebook/complete`)
          .set(headers())
          .send({ code: 'code', state })
      ).status,
    ).toBe(422);
    const complete = await request(app)
      .post(`${base()}/oauth/facebook/complete`)
      .set(headers())
      .set('Cookie', cookie)
      .send({ code: 'code', state });
    expect(complete.status).toBe(201);
    expect(complete.body.data.candidates).toHaveLength(2);
    expect(JSON.stringify(complete.body)).not.toContain('oauth-private-token');
    expect(
      (
        await request(app)
          .post(`${base()}/oauth/facebook/complete`)
          .set(headers())
          .set('Cookie', cookie)
          .send({ code: 'code', state })
      ).status,
    ).toBe(422);
    const selected = await request(app)
      .post(`${base()}/oauth/facebook/select`)
      .set(headers())
      .send({ state, accountIds: ['page-a'] });
    expect(selected.status).toBe(201);
    expect(
      (selected.body.data as { externalId: string; id: string }[]).find(
        (a: { externalId: string }) => a.externalId === 'page-a',
      )?.id,
    ).toBe(accountId);
    expect(
      (selected.body.data as { externalId: string }[]).some(
        (a: { externalId: string }) => a.externalId === 'not-selected',
      ),
    ).toBe(false);
    expect(
      (
        await request(app)
          .post(`${base()}/oauth/facebook/select`)
          .set(headers())
          .send({ state, accountIds: ['page-a'] })
      ).status,
    ).toBe(422);
  });
  it('validates uploaded bytes, persists media and denies cross-client reuse', async () => {
    expect(
      (
        await request(app)
          .post(`${base()}/media`)
          .set(headers())
          .send({
            name: 'spoof.jpg',
            mimeType: 'image/jpeg',
            base64: Buffer.from('<script>').toString('base64'),
          })
      ).status,
    ).toBe(422);
    const body = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#aabbcc' },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await request(app)
      .post(`${base()}/media`)
      .set(headers())
      .send({
        name: 'post.jpg',
        mimeType: 'image/jpeg',
        base64: body.toString('base64'),
      });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.width).toBe(12);
    expect(
      (
        await request(app)
          .get(`/api/social/clients/${otherClient}/media/${uploaded.body.data.id}`)
          .set(headers(reviewer))
      ).status,
    ).toBe(404);
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send({ ...content('Photo draft'), mediaIds: [uploaded.body.data.id] });
    expect(created.body.data.media[0].id).toBe(uploaded.body.data.id);
  });
  it('can remove a shared attached link from an individual destination', async () => {
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send({
        ...content('Shared message', [accountId, secondAccountId]),
        link: 'https://example.com/news',
        overrides: { [secondAccountId]: { link: '' } },
      });
    expect(created.status).toBe(201);
    expect(
      (
        created.body.data.destinations as { accountId: string; link: string | null }[]
      ).find((d: { accountId: string }) => d.accountId === secondAccountId)?.link,
    ).toBeNull();
    const duplicate = await request(app)
      .post(`${base()}/posts/${created.body.data.id}/actions`)
      .set(headers())
      .send({ action: 'duplicate' });
    expect(
      (
        duplicate.body.data.destinations as { accountId: string; link: string | null }[]
      ).find((d: { accountId: string }) => d.accountId === secondAccountId)?.link,
    ).toBeNull();
  });
  it('retains destination-only media across details and duplication', async () => {
    const body = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#aabbcc' },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await request(app)
      .post(`${base()}/media`)
      .set(headers())
      .send({
        name: 'override.jpg',
        mimeType: 'image/jpeg',
        base64: body.toString('base64'),
      });
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send({
        ...content('Destination image'),
        overrides: { [accountId]: { mediaIds: [uploaded.body.data.id] } },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.sharedMediaIds).toEqual([]);
    expect(created.body.data.media[0].id).toBe(uploaded.body.data.id);
    const duplicate = await request(app)
      .post(`${base()}/posts/${created.body.data.id}/actions`)
      .set(headers())
      .send({ action: 'duplicate' });
    expect(duplicate.body.data.sharedMediaIds).toEqual([]);
    expect(duplicate.body.data.destinations[0].mediaIds).toEqual([uploaded.body.data.id]);
  });
  it('refreshes expired tokens, marks revoked grants for reconnect, and rejects expired OAuth requests', async () => {
    const refreshed = await saveConnectionAccounts(ownerCtx(), client, [
      {
        platform: 'facebook',
        externalId: 'expired-page',
        name: 'Expired page',
        capabilities,
        credentials: {
          accessToken: 'expired-token',
          refreshToken: 'test-refresh',
          expiresAt: '2026-01-01T00:00:00Z',
          scopes: [],
        },
      },
    ]);
    const expiredId = refreshed.find((a) => a.externalId === 'expired-page')!.id;
    fake.refresh.mockResolvedValue({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresAt: '2099-01-01T00:00:00Z',
      scopes: [],
    });
    const created = await request(app)
      .post(`${base()}/posts`)
      .set(headers())
      .send(content('revoked', [expiredId]));
    await request(app)
      .post(`${base()}/posts/${created.body.data.id}/publish`)
      .set(headers())
      .send({});
    await runPublishingSweep(jobCtx());
    expect(fake.refresh).toHaveBeenCalled();
    const accounts = await request(app).get(`${base()}/accounts`).set(headers());
    expect(
      (accounts.body.data as { id: string; status: string }[]).find(
        (a: { id: string }) => a.id === expiredId,
      )?.status,
    ).toBe('reconnect_required');
    const started = await request(app)
      .post(`${base()}/oauth/facebook/start`)
      .set(headers())
      .send({});
    const state = new URL(started.body.data.authorizationUrl as string).searchParams.get(
      'state',
    )!;
    const cookie = (started.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!;
    expect(
      (
        await request(app).get(
          `/api/social/oauth/facebook/callback?${new URLSearchParams({ code: 'code', state }).toString()}`,
        )
      ).status,
    ).toBe(400);
    const callback = await request(app)
      .get(
        `/api/social/oauth/facebook/callback?${new URLSearchParams({ code: 'code', state }).toString()}`,
      )
      .set('Cookie', cookie);
    expect(callback.status).toBe(303);
    expect(callback.headers['location']).toMatch(
      /^http:\/\/localhost:5173\/company\/social#social-oauth=/,
    );
    await admin(
      sql`UPDATE social_oauth_state SET expires_at=now()-interval '1 minute' WHERE organization_id=${org}`,
    );
    expect(
      (
        await request(app)
          .post(`${base()}/oauth/facebook/complete`)
          .set(headers())
          .set('Cookie', cookie)
          .send({ code: 'code', state })
      ).status,
    ).toBe(422);
  });
  it('synchronizes real-shaped metrics through mocked APIs and removes credentials on disconnect', async () => {
    expect(
      (await request(app).post(`${base()}/analytics/sync`).set(headers()).send({}))
        .status,
    ).toBe(201);
    const analytics = await request(app)
      .get(`${base()}/analytics?from=2026-10-01&to=2026-10-31`)
      .set(headers());
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.snapshots[0].metrics[0].value).toBe(42);
    expect(
      (await request(app).delete(`${base()}/accounts/${accountId}`).set(headers()))
        .status,
    ).toBe(200);
    const rows = await db.query<{ credentialsEncrypted: string | null }>(
      ownerCtx(),
      sql`SELECT c.credentials_encrypted FROM social_connection c JOIN social_account a ON a.connection_id=c.id WHERE a.id=${accountId}`,
    );
    expect(rows[0]?.credentialsEncrypted).toBeNull();
  });
});
