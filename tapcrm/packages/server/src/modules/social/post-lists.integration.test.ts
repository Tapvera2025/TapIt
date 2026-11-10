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
import { ProviderError } from './providers/types.js';
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
    listProviderReadiness: () => ['facebook'].map(readiness),
    getProvider: provider,
    getCompanyProvider: provider,
  };
});

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
describe.skipIf(!enabled)('Post lists by section', () => {
  const org = randomUUID();
  const owner = randomUUID();
  const department = randomUUID();
  const position = randomUUID();
  const client = randomUUID();
  let app: ReturnType<typeof buildApp>;
  let account = '';
  const ids: Record<string, string> = {};
  const adminQuery = <T>(fragment: ReturnType<typeof sql>) =>
    platformDb.query<T>('migration', 'isolated post list fixture', fragment);
  const headers = { 'x-dev-user-id': owner, 'x-dev-organization-id': org };
  const workspace = `/api/social/clients/${client}`;
  const sweep = () =>
    runPublishingSweep(
      createJobContext({
        organizationId: org,
        principal: systemPrincipal(org),
        jobName: 'social-post-lists-test',
        runId: randomUUID(),
      }),
    );
  async function draft(caption: string): Promise<string> {
    const created = await request(app)
      .post(`${workspace}/posts`)
      .set(headers)
      .send({ caption, accountIds: [account], mediaIds: [], intent: 'draft' });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  }
  const publish = (postId: string, scheduledAt?: string) =>
    request(app)
      .post(`${workspace}/posts/${postId}/publish`)
      .set(headers)
      .send(scheduledAt ? { scheduledAt } : {});
  async function list(status: string): Promise<string[]> {
    const response = await request(app)
      .get(
        `${workspace}/posts?${new URLSearchParams({ status, pageSize: '100' }).toString()}`,
      )
      .set(headers);
    expect(response.status).toBe(200);
    return (response.body.data.items as { caption: string }[])
      .map((item) => item.caption)
      .sort();
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
      throw new Error('Refusing post list fixtures outside a test database');
    vi.stubEnv('IDENTITY_DEV_BYPASS', 'true');
    vi.stubEnv('SOCIAL_TOKEN_ENCRYPTION_KEY', '7c'.repeat(32));
    vi.stubEnv('SOCIAL_PUBLIC_BASE_URL', 'http://localhost:5173');
    __resetConfig();
    await adminQuery(
      sql`INSERT INTO organization(id,code,name) VALUES (${org},${`lists-${org.slice(0, 8)}`},'Agency')`,
    );
    await adminQuery(
      sql`INSERT INTO department(id,organization_id,code,name,kind) VALUES (${department},${org},'SOCIAL','Social','support')`,
    );
    await adminQuery(
      sql`INSERT INTO position(id,organization_id,department_id,code,name,organizational_level) VALUES (${position},${org},${department},'SOCIAL','Social',10)`,
    );
    await adminQuery(sql`INSERT INTO app_user(id,organization_id,account_type,email,full_name,status,department_id,position_id,employee_id)
      VALUES (${owner},${org},'employee',${`${org}-owner@lists-test.invalid`},'Social Manager','active',${department},${position},${owner.toUpperCase()})`);
    await adminQuery(
      sql`INSERT INTO client(id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${client},${org},'Acme Dental','Acme Dental',${`${client}@lists-test.invalid`},'in','INR','Asia/Kolkata',${owner})`,
    );
    await adminQuery(
      sql`INSERT INTO organization_module(organization_id,module_id) SELECT ${org},id FROM module WHERE key = 'social'`,
    );
    await adminQuery(
      sql`INSERT INTO position_policy(organization_id,position_id,action,allowed,scope) SELECT ${org},${position},action,true,'own' FROM registry_action WHERE module = 'social'`,
    );
    app = buildApp();
    const [saved] = await saveConnectionAccounts(
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
      }),
      client,
      [
        {
          platform: 'facebook',
          externalId: 'page-1',
          name: 'Acme Dental',
          capabilities: {
            publishText: true,
            publishImages: true,
            publishVideo: true,
            accountInsights: false,
            postInsights: false,
          },
          credentials: { accessToken: 'page-token', scopes: [] },
        },
      ],
    );
    account = saved!.id;

    ids['draft'] = await draft('A draft');
    ids['scheduled'] = await draft('Scheduled for next year');
    expect((await publish(ids['scheduled'], '2099-06-01T10:00:00+05:30')).status).toBe(
      201,
    );
    ids['published'] = await draft('Published now');
    ids['failed'] = await draft('Failed to publish');
    fake.publish
      .mockResolvedValueOnce({ externalPostId: 'fb-1' })
      .mockRejectedValueOnce(
        new ProviderError('POST_INVALID', 'Rejected by the platform.'),
      );
    expect((await publish(ids['published'])).status).toBe(201);
    await sweep();
    expect((await publish(ids['failed'])).status).toBe(201);
    await sweep();
  });
  afterAll(async () => {
    __resetStorageService();
    await closePools();
    vi.unstubAllEnvs();
  });

  it('lists every not-yet-published post under Drafts & Scheduled, a scheduled one included', async () => {
    expect(
      await list('draft,pending_approval,approved,scheduled,publishing,failed'),
    ).toEqual(['A draft', 'Failed to publish', 'Scheduled for next year']);
    expect(await list('published,partially_published')).toEqual(['Published now']);
  });

  it('still filters by one status, and refuses an unknown one', async () => {
    expect(await list('scheduled')).toEqual(['Scheduled for next year']);
    expect(await list('')).toHaveLength(4);
    const refused = await request(app)
      .get(`${workspace}/posts?status=draft,sent`)
      .set(headers);
    expect(refused.status).toBe(422);
  });
});
