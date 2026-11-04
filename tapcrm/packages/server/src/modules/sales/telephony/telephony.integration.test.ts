import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { Response as ExpressResponse } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authorize } from '@tapcrm/authz';
import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { CREDENTIALS_KEY_ENV } from './crypto.js';
import { registerTelephonyPolicies } from './policy.js';
import { __setTelephonyClientFactory, type TelephonyClient } from './providers/index.js';
import { findConnectionView, loadCallResource } from './repository.js';
import {
  createConnection,
  disconnectConnection,
  getOverview,
  listAgents,
  listCalls,
  listPeople,
  mapAgent,
  rematchAgents,
  streamRecording,
  syncConnectionNow,
  testConnection,
} from './service.js';
import { runConnectionSync } from './sync.js';
import type { NormalizedAgent, NormalizedCall } from './types.js';

/**
 * Call Analytics against real PostgreSQL: connect → sync → match → scope.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run telephony.integration
 *
 * The calling platform is a fake TelephonyClient; everything below it
 * (migrations, RLS, upserts, matching, visibility filters) is real.
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const OTHER_ORG = randomUUID();
const DEPARTMENT = randomUUID();
const AGENT_POSITION = randomUUID();
const LEAD_POSITION = randomUUID();
const TEAM_A = randomUUID();
const TEAM_B = randomUUID();
const ASHA = randomUUID();
const DEV = randomUUID();
const LEAD = randomUUID();
const SUPER_ADMIN = randomUUID();
const OTHER_ADMIN = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) => platformDb.query('migration', reason, fragment);

const employee = (id: string, teamId: string, positionId: string): Principal => ({
  id,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'employee',
  teamId,
  departmentId: DEPARTMENT,
  positionId,
  reportsTo: null,
  organizationalLevel: 1,
});

const ctxFor = (principal: Principal, organizationId = ORG) =>
  createJobContext({ organizationId, principal, jobName: 'telephony.test', runId: `${RUN}-${randomUUID()}` });

const admin = () => ctxFor({ id: SUPER_ADMIN, organizationId: ORG, sessionVersion: 0, accountType: 'super-admin' });

/* ---------------- fake platform ---------------- */

const today = new Date();
const minutesAgo = (minutes: number) => new Date(today.getTime() - minutes * 60_000);

function agent(externalId: string, name: string, email: string | null): NormalizedAgent {
  return { externalId, name, email, role: 'Agent', extension: null, timeZone: null, phoneNumbers: [], groups: ['Sales'], isActive: true, metadata: {} };
}

function call(externalId: string, agentRef: { externalId: string; name: string; email: string | null } | null, overrides: Partial<NormalizedCall> = {}): NormalizedCall {
  const startedAt = overrides.startedAt ?? minutesAgo(60);
  return {
    externalId,
    agent: agentRef,
    direction: 'inbound',
    outcome: 'answered',
    providerStatus: 'Answered',
    missedReason: null,
    startedAt,
    answeredAt: null,
    endedAt: new Date(startedAt.getTime() + 120_000),
    durationSeconds: 120,
    talkSeconds: 100,
    ringSeconds: 5,
    holdSeconds: null,
    queueWaitSeconds: null,
    wrapUpSeconds: null,
    contactNumber: '+919800000001',
    contactName: 'Rahul Shah',
    contactEmail: null,
    businessNumber: '+14155550100',
    businessNumberName: 'Sales line',
    hasRecording: true,
    hasVoicemail: false,
    notes: null,
    disposition: null,
    tags: [],
    rating: null,
    aiSummary: null,
    aiSentiment: null,
    aiScore: null,
    providerLink: null,
    metadata: {},
    ...overrides,
  };
}

const ashaRef = { externalId: '101', name: 'Asha (JustCall)', email: 'ASHA.' + RUN + '@tapvera.test' };
const devRef = { externalId: '102', name: 'Dev (JustCall)', email: 'dev.' + RUN + '@tapvera.test' };
const frontDeskRef = { externalId: '103', name: 'Front desk', email: 'frontdesk@shared.test' };
const goneRef = { externalId: '199', name: 'Deleted user', email: null };

let platformCalls: NormalizedCall[] = [];
let rejectKeys = false;
const recordingRequests: string[] = [];

const fakeClient: TelephonyClient = {
  provider: 'justcall',
  async verify() {
    if (rejectKeys) {
      const { ProviderError } = await import('./errors.js');
      throw new ProviderError('JustCall rejected the API credentials.', 'rejected', 401);
    }
    return { accountLabel: null };
  },
  async listAgents() {
    // Asha's platform email differs from her CRM email only in case.
    return [agent('101', ashaRef.name, ashaRef.email), agent('102', devRef.name, devRef.email), agent('103', frontDeskRef.name, frontDeskRef.email)];
  },
  async listCalls(_window, onPage) {
    await onPage(platformCalls.slice(0, 4), 4);
    await onPage(platformCalls.slice(4), platformCalls.length - 4);
  },
  async fetchRecording(externalId) {
    recordingRequests.push(externalId);
    return new Response(new Uint8Array([7, 7, 7]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '3' } });
  },
};

class CapturingResponse extends Writable {
  chunks: Buffer[] = [];
  headers: Record<string, string> = {};
  statusCode = 0;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void) {
    this.chunks.push(chunk);
    done();
  }
}

async function waitForSync(connectionId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const view = await findConnectionView(admin(), connectionId);
    if (view && view.lastSyncStatus && view.lastSyncStatus !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('sync did not finish');
}

describe.skipIf(!enabled)('Call Analytics (PostgreSQL)', () => {
  let connectionId = '';
  let previousKey: string | undefined;

  beforeAll(async () => {
    installAuthz();
    registerTelephonyPolicies();
    previousKey = process.env[CREDENTIALS_KEY_ENV];
    process.env[CREDENTIALS_KEY_ENV] = randomBytes(32).toString('hex');
    __setTelephonyClientFactory(() => fakeClient);

    await asOwner('org', sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`TC${RUN}`}, 'Telephony Test', 'Asia/Kolkata'), (${OTHER_ORG}, ${`TO${RUN}`}, 'Other Co', 'UTC')`);
    await asOwner('department', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPARTMENT}, ${ORG}, 'sales', 'Sales', 'sales')`);
    await asOwner(
      'positions',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${AGENT_POSITION}, ${ORG}, ${DEPARTMENT}, 'sales-agent', 'Sales Agent', 1),
                 (${LEAD_POSITION}, ${ORG}, ${DEPARTMENT}, 'sales-team-lead', 'Sales Team Lead', 3)`,
    );
    await asOwner(
      'policies',
      sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
          VALUES (${ORG}, ${AGENT_POSITION}, 'telephony:view', true, 'own'),
                 (${ORG}, ${AGENT_POSITION}, 'telephony:listen', true, 'own'),
                 (${ORG}, ${LEAD_POSITION}, 'telephony:view', true, 'team')`,
    );
    await asOwner(
      'teams',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name)
          VALUES (${TEAM_A}, ${ORG}, ${DEPARTMENT}, 'sales-team', 'Team A'), (${TEAM_B}, ${ORG}, ${DEPARTMENT}, 'sales-team', 'Team B')`,
    );
    await asOwner(
      'employees',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, email, status, position_id, department_id, team_id, employee_id)
          VALUES (${ASHA}, ${ORG}, 'employee', 'Asha Rao', ${`asha.${RUN}@tapvera.test`}, 'active', ${AGENT_POSITION}, ${DEPARTMENT}, ${TEAM_A}, ${`E-A${RUN}`}),
                 (${DEV}, ${ORG}, 'employee', 'Dev Patel', ${`dev.${RUN}@tapvera.test`}, 'active', ${AGENT_POSITION}, ${DEPARTMENT}, ${TEAM_B}, ${`E-D${RUN}`}),
                 (${LEAD}, ${ORG}, 'employee', 'Lena Lead', ${`lead.${RUN}@tapvera.test`}, 'active', ${LEAD_POSITION}, ${DEPARTMENT}, ${TEAM_A}, ${`E-L${RUN}`})`,
    );
    await asOwner(
      'admins',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status)
          VALUES (${SUPER_ADMIN}, ${ORG}, 'super-admin', 'Admin', 'active'), (${OTHER_ADMIN}, ${OTHER_ORG}, 'super-admin', 'Other Admin', 'active')`,
    );

    platformCalls = [
      call('5001', ashaRef, { startedAt: minutesAgo(30) }),
      call('5002', ashaRef, { outcome: 'missed', talkSeconds: 0, hasRecording: false, startedAt: minutesAgo(40) }),
      call('5003', ashaRef, { direction: 'outbound', outcome: 'unanswered', talkSeconds: 0, startedAt: minutesAgo(50) }),
      call('5004', devRef, { direction: 'outbound', talkSeconds: 300, startedAt: minutesAgo(70) }),
      call('5005', devRef, { startedAt: minutesAgo(80), contactNumber: '+919800000002' }),
      call('5006', frontDeskRef, { startedAt: minutesAgo(90) }),
      call('5007', goneRef, { startedAt: minutesAgo(100), hasRecording: false }),
    ];
  });

  afterAll(async () => {
    __setTelephonyClientFactory(null);
    if (previousKey === undefined) delete process.env[CREDENTIALS_KEY_ENV];
    else process.env[CREDENTIALS_KEY_ENV] = previousKey;
    for (const organization of [ORG, OTHER_ORG]) {
      await asOwner('cleanup calls', sql`DELETE FROM telephony_call WHERE organization_id = ${organization}`);
      await asOwner('cleanup runs', sql`DELETE FROM telephony_sync_run WHERE organization_id = ${organization}`);
      await asOwner('cleanup agents', sql`DELETE FROM telephony_agent WHERE organization_id = ${organization}`);
      await asOwner('cleanup connections', sql`DELETE FROM telephony_connection WHERE organization_id = ${organization}`);
      await asOwner('cleanup audit', sql`DELETE FROM audit_outbox WHERE organization_id = ${organization}`);
      await asOwner('cleanup policies', sql`DELETE FROM position_policy WHERE organization_id = ${organization}`);
      await asOwner('cleanup email directory', sql`DELETE FROM identity_email_directory WHERE organization_id = ${organization}`);
      await asOwner('cleanup users', sql`DELETE FROM app_user WHERE organization_id = ${organization}`);
      await asOwner('cleanup teams', sql`DELETE FROM team WHERE organization_id = ${organization}`);
      await asOwner('cleanup positions', sql`DELETE FROM position WHERE organization_id = ${organization}`);
      await asOwner('cleanup departments', sql`DELETE FROM department WHERE organization_id = ${organization}`);
      await asOwner('cleanup org', sql`DELETE FROM organization WHERE id = ${organization}`);
    }
    await closePools();
  });

  it('refuses keys the platform rejects, and saves nothing', async () => {
    rejectKeys = true;
    await expect(
      createConnection(admin(), { backfillDays: 30, credentials: { provider: 'justcall', apiKey: 'bad-key-123', apiSecret: 'bad-secret-1' } }),
    ).rejects.toMatchObject({ kind: 'rejected' });
    rejectKeys = false;
    const rows = await asOwner('count connections', sql`SELECT count(*)::int AS n FROM telephony_connection WHERE organization_id = ${ORG}`);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('connects, stores the key encrypted and runs the first sync', async () => {
    const view = await createConnection(admin(), {
      label: 'JustCall India',
      backfillDays: 30,
      credentials: { provider: 'justcall', apiKey: 'jc-live-key-9876', apiSecret: 'jc-live-secret-1' },
    });
    connectionId = view.id;
    expect(view).toMatchObject({ provider: 'justcall', label: 'JustCall India', status: 'active', credentialsHint: '••••9876' });

    const stored = await asOwner('read ciphertext', sql`SELECT credentials_encrypted FROM telephony_connection WHERE id = ${connectionId}`);
    const ciphertext = (stored[0] as { credentialsEncrypted: string }).credentialsEncrypted;
    expect(ciphertext.startsWith('v1.')).toBe(true);
    expect(ciphertext).not.toContain('jc-live-key');

    await waitForSync(connectionId);
    const after = await findConnectionView(admin(), connectionId);
    expect(after).toMatchObject({ lastSyncStatus: 'succeeded', callCount: 7, agentCount: 4, matchedAgentCount: 2, unmatchedAgentCount: 2 });
    expect(after?.syncedThrough).not.toBeNull();
  });

  it('matches platform users to employees by email, case-insensitively', async () => {
    const agents = await listAgents(admin(), { status: 'all' });
    const byExternal = new Map(agents.map((row) => [row.externalId, row]));
    expect(byExternal.get('101')).toMatchObject({ employeeId: ASHA, matchMethod: 'email', employeeName: 'Asha Rao', callCount: 3 });
    expect(byExternal.get('102')).toMatchObject({ employeeId: DEV, matchMethod: 'email', callCount: 2 });
    expect(byExternal.get('103')).toMatchObject({ employeeId: null, matchMethod: 'none' });
    // Seen only on a call: kept so its history is not lost.
    expect(byExternal.get('199')).toMatchObject({ name: 'Deleted user', matchMethod: 'none', callCount: 1 });
  });

  it('gives Super Admin everything, unmatched calls included', async () => {
    const overview = await getOverview(admin(), {});
    expect(overview.totals).toMatchObject({ totalCalls: 7, inbound: 5, outbound: 2, answered: 5, missedInbound: 1 });
    const unmatched = overview.employees.find((row) => row.employeeId === null);
    expect(unmatched?.totalCalls).toBe(2);
    expect(overview.daily.length).toBe(30);
    expect(overview.connections.map((item) => item.provider)).toEqual(['justcall']);
    const unmatchedOnly = await listCalls(admin(), { unmatched: true, page: 1, pageSize: 50 });
    expect(unmatchedOnly.items.map((item) => item.contactName)).toHaveLength(2);
  });

  it('shows an employee only their own calls', async () => {
    const ctx = ctxFor(employee(ASHA, TEAM_A, AGENT_POSITION));
    const overview = await getOverview(ctx, {});
    expect(overview.totals.totalCalls).toBe(3);
    expect(overview.employees.map((row) => row.employeeId)).toEqual([ASHA]);
    const calls = await listCalls(ctx, { unmatched: false, page: 1, pageSize: 50 });
    expect(calls.total).toBe(3);
    expect(new Set(calls.items.map((item) => item.employeeName))).toEqual(new Set(['Asha Rao']));

    const devCall = await asOwner('dev call', sql`SELECT id FROM telephony_call WHERE organization_id = ${ORG} AND external_id = '5004'`);
    const resource = await loadCallResource(ctx, (devCall[0] as { id: string }).id);
    await expect(authorize(ctx, 'telephony:view', resource!)).rejects.toThrow();
    const people = await listPeople(ctx);
    expect(people.employees.map((row) => row.id)).toEqual([ASHA]);
  });

  it('shows a team lead their team, not the other team', async () => {
    const ctx = ctxFor(employee(LEAD, TEAM_A, LEAD_POSITION));
    const overview = await getOverview(ctx, {});
    expect(overview.totals.totalCalls).toBe(3);
    const people = await listPeople(ctx);
    expect(people.teams).toEqual([{ id: TEAM_A, name: 'Team A' }]);
    const teamOnly = await listCalls(ctx, { teamId: TEAM_B, unmatched: false, page: 1, pageSize: 50 });
    expect(teamOnly.total).toBe(0);
  });

  it('lets an admin map a shared line by hand, and the email matcher leaves that alone', async () => {
    const agents = await listAgents(admin(), { status: 'unmatched' });
    const frontDesk = agents.find((row) => row.externalId === '103')!;
    const mapped = await mapAgent(admin(), frontDesk.id, { mode: 'employee', employeeId: DEV });
    expect(mapped).toMatchObject({ employeeId: DEV, matchMethod: 'manual' });

    const gone = agents.find((row) => row.externalId === '199')!;
    expect(await mapAgent(admin(), gone.id, { mode: 'ignore' })).toMatchObject({ matchMethod: 'ignored', employeeId: null });

    await rematchAgents(admin());
    const after = new Map((await listAgents(admin(), { status: 'all' })).map((row) => [row.externalId, row]));
    expect(after.get('103')).toMatchObject({ employeeId: DEV, matchMethod: 'manual' });
    expect(after.get('101')).toMatchObject({ employeeId: ASHA, matchMethod: 'email' });
    expect(after.get('199')?.matchMethod).toBe('ignored');

    const devCtx = ctxFor(employee(DEV, TEAM_B, AGENT_POSITION));
    expect((await getOverview(devCtx, {})).totals.totalCalls).toBe(3);
  });

  it('re-syncs idempotently and picks up notes added after the call', async () => {
    platformCalls = platformCalls.map((item) => (item.externalId === '5001' ? { ...item, notes: 'Follow up on Friday', disposition: 'Interested' } : item));
    const result = await runConnectionSync(admin(), connectionId, 'manual', SUPER_ADMIN);
    expect(result.outcome).toMatchObject({ status: 'succeeded', callsCreated: 0, callsUpdated: 7 });
    const count = await asOwner('count calls', sql`SELECT count(*)::int AS n FROM telephony_call WHERE organization_id = ${ORG}`);
    expect(count[0]).toEqual({ n: 7 });
    const searched = await listCalls(admin(), { search: 'Friday', unmatched: false, page: 1, pageSize: 50 });
    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]?.disposition).toBe('Interested');
  });

  it('keeps one sync per connection at a time', async () => {
    await asOwner('pretend running', sql`UPDATE telephony_connection SET last_sync_status = 'running', last_sync_started_at = now() WHERE id = ${connectionId}`);
    const skipped = await runConnectionSync(admin(), connectionId, 'manual', SUPER_ADMIN);
    expect(skipped.skipped).toBe(true);
    await asOwner('reset', sql`UPDATE telephony_connection SET last_sync_status = 'succeeded' WHERE id = ${connectionId}`);
  });

  it('streams a recording through the CRM', async () => {
    const own = await asOwner('asha call', sql`SELECT id FROM telephony_call WHERE organization_id = ${ORG} AND external_id = '5001'`);
    const res = new CapturingResponse();
    await streamRecording(ctxFor(employee(ASHA, TEAM_A, AGENT_POSITION)), (own[0] as { id: string }).id, res as unknown as ExpressResponse);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('audio/mpeg');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.concat(res.chunks)).toEqual(Buffer.from([7, 7, 7]));
    expect(recordingRequests).toContain('5001');

    const silent = await asOwner('no recording', sql`SELECT id FROM telephony_call WHERE organization_id = ${ORG} AND external_id = '5002'`);
    await expect(streamRecording(admin(), (silent[0] as { id: string }).id, new CapturingResponse() as unknown as ExpressResponse)).rejects.toMatchObject({
      code: 'TELEPHONY_NO_RECORDING',
    });
  });

  it('keeps every company to its own calls (RLS)', async () => {
    const other = ctxFor({ id: OTHER_ADMIN, organizationId: OTHER_ORG, sessionVersion: 0, accountType: 'super-admin' }, OTHER_ORG);
    expect((await getOverview(other, {})).totals.totalCalls).toBe(0);
    expect((await listCalls(other, { unmatched: false, page: 1, pageSize: 50 })).total).toBe(0);
  });

  it('re-tests the key, and disconnecting wipes it but keeps history', async () => {
    expect((await testConnection(admin(), connectionId)).ok).toBe(true);
    const disconnected = await disconnectConnection(admin(), connectionId);
    expect(disconnected).toMatchObject({ status: 'disconnected', credentialsHint: null, callCount: 7 });
    const stored = await asOwner('read wiped', sql`SELECT credentials_encrypted FROM telephony_connection WHERE id = ${connectionId}`);
    expect(stored[0]).toEqual({ credentialsEncrypted: null });
    await expect(syncConnectionNow(admin(), connectionId)).rejects.toMatchObject({ code: 'TELEPHONY_NOT_ELIGIBLE' });
    expect((await getOverview(admin(), {})).totals.totalCalls).toBe(7);
  });
});
