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
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  __resetStorageService,
  __setStorageService,
} from '../../platform/storage/index.js';
import { runPublishingSweep } from './jobs.js';
import { saveConnectionAccounts } from './service.js';

const fake = vi.hoisted(() => ({ publish: vi.fn() }));
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
    publishPost: fake.publish,
  });
  return {
    getProviderReadiness: readiness,
    listProviderReadiness: () => ['facebook', 'linkedin', 'youtube'].map(readiness),
    getProvider: provider,
    getCompanyProvider: provider,
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)('Video placements: Reels and YouTube visibility', () => {
  const org = randomUUID();
  const owner = randomUUID();
  const department = randomUUID();
  const position = randomUUID();
  const client = randomUUID();
  let app: ReturnType<typeof buildApp>;
  const accounts: Record<string, string> = {};
  const adminQuery = <T>(fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', 'isolated video placement fixture', fragment);
  const headers = { 'x-dev-user-id': owner, 'x-dev-organization-id': org };
  const workspace = `/api/social/clients/${client}`;
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
  const capabilities = {
    publishText: true,
    publishImages: true,
    publishVideo: true,
    accountInsights: false,
    postInsights: false,
  };

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
      throw new Error('Refusing video fixtures outside a test database');
    vi.stubEnv('IDENTITY_DEV_BYPASS', 'true');
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', '9a'.repeat(32));
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
    __resetConfig();
    await adminQuery(
      sql`INSERT INTO organization(id,code,name) VALUES (${org},${`video-${org.slice(0, 8)}`},'Agency')`,
    );
    await adminQuery(
      sql`INSERT INTO department(id,organization_id,code,name,kind) VALUES (${department},${org},'SOCIAL','Social','support')`,
    );
    await adminQuery(
      sql`INSERT INTO position(id,organization_id,department_id,code,name,organizational_level) VALUES (${position},${org},${department},'SOCIAL','Social',10)`,
    );
    await adminQuery(sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status,department_id,position_id,employee_id)
      VALUES (${owner},${org},'employee',${`${org}-owner@video-test.invalid`},'Social Manager','active',${department},${position},${owner.toUpperCase()})`);
    await adminQuery(
      sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${client},${org},'Acme Dental','Acme Dental',${`${client}@video-test.invalid`},'in','INR','Asia/Kolkata',${owner})`,
    );
    await adminQuery(
      sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${org},id FROM module WHERE key = 'social'`,
    );
    await adminQuery(
      sql`INSERT INTO position_policy(organization_id,position_id,action,allowed,scope) SELECT ${org},${position},action,true,'own' FROM registry_action WHERE module = 'social'`,
    );
    app = buildApp();
    const saved = await saveConnectionAccounts(
      ownerCtx(),
      client,
      (['facebook', 'linkedin', 'youtube'] as const).map((platform) => ({
        platform,
        externalId: `${platform}-1`,
        name: `Acme on ${platform}`,
        capabilities,
        credentials: { accessToken: `${platform}-token`, scopes: [] },
      })),
    );
    for (const item of saved) accounts[item.platform] = item.id;
  });
  afterAll(async () => {
    __resetStorageService();
    await closePools();
    vi.unstubAllEnvs();
  });

  it('keeps a Facebook Reel and a YouTube visibility from draft to publishing', async () => {
    const created = await request(app)
      .post(`${workspace}/posts`)
      .set(headers)
      .send({
        caption: 'Smile week',
        accountIds: [accounts['facebook'], accounts['youtube']],
        mediaIds: [],
        overrides: {
          [accounts['facebook']!]: { postType: 'reel' },
          [accounts['youtube']!]: { title: 'Smile week', privacyStatus: 'unlisted' },
        },
        intent: 'draft',
      });
    expect(created.status).toBe(201);
    const destinations = created.body.data.destinations as {
      platform: string;
      postType: string;
      privacyStatus: string | null;
    }[];
    expect(
      destinations
        .map((item) => [item.platform, item.postType, item.privacyStatus])
        .sort(),
    ).toEqual([
      ['facebook', 'reel', null],
      ['youtube', 'feed', 'unlisted'],
    ]);

    fake.publish.mockImplementation(async () => ({ externalPostId: randomUUID() }));
    expect(
      (
        await request(app)
          .post(`${workspace}/posts/${created.body.data.id}/publish`)
          .set(headers)
          .send({})
      ).status,
    ).toBe(201);
    await runPublishingSweep(
      createJobContext({
        organizationId: org,
        principal: systemPrincipal(org),
        jobName: 'social-video-test',
        runId: randomUUID(),
      }),
    );
    const contents = (
      fake.publish.mock.calls as [
        {
          account: { platform: string };
          content: { postType?: string; privacyStatus?: string };
        },
      ][]
    ).map(([input]) => [
      input.account.platform,
      input.content.postType,
      input.content.privacyStatus,
    ]);
    expect(contents.sort()).toEqual([
      ['facebook', 'reel', undefined],
      ['youtube', 'feed', 'unlisted'],
    ]);
  });

  it('refuses a Reel on a platform without Reels', async () => {
    const refused = await request(app)
      .post(`${workspace}/posts`)
      .set(headers)
      .send({
        caption: 'Smile week',
        accountIds: [accounts['linkedin']],
        mediaIds: [],
        overrides: { [accounts['linkedin']!]: { postType: 'reel' } },
        intent: 'draft',
      });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toMatch(
      /Reels are supported for Facebook and Instagram/,
    );
  });
});
