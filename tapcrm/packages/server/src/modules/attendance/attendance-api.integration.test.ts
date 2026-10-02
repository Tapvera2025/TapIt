import { randomUUID } from 'node:crypto';
import { authorize } from '@tapcrm/authz';
import type { Principal } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
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
  type StorageService,
} from '../../platform/storage/index.js';
import { toDateOnly } from '../../platform/time.js';
import { openDay } from './day-open.js';
import {
  CSV_HEADER,
  DOWNLOAD_LINK_SECONDS,
  EXPORT_COLUMNS,
  getExportStatus,
  requestExport,
  runExport,
} from './export.js';
import { registerAttendancePolicies } from './policy.js';
import { loadAttendanceSubject } from './routes.js';
import { listRecords } from './service.js';

/**
 * The attendance API (§8.7) against real PostgreSQL: scope filtering, AT-13,
 * the subject-keyed check for a day's detail, and the export — frozen scope,
 * owner-only status, audit (AT-14), and a signed link only once the file
 * exists (SE-6).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const OPS = randomUUID();
const SALES = randomUUID();
const POS = {
  admin: randomUUID(),
  manager: randomUUID(),
  staff: randomUUID(),
  seller: randomUUID(),
};
const ADMIN = randomUUID();
const MANAGER = randomUUID();
const STAFF = randomUUID();
const SELLER = randomUUID();
const d = toDateOnly;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const system = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

function as(userId: string, positionId: string, departmentId: string) {
  const principal: Principal = {
    id: userId,
    organizationId: ORG,
    sessionVersion: 1,
    accountType: 'employee',
    positionId,
    departmentId,
    teamId: null,
    reportsTo: null,
    organizationalLevel: 30,
  };
  return createRequestContext({
    organizationId: ORG,
    principal,
    requestId: randomUUID(),
  });
}
const admin = () => as(ADMIN, POS.admin, OPS);
const manager = () => as(MANAGER, POS.manager, OPS);
const staff = () => as(STAFF, POS.staff, OPS);

/** Object storage without a running server: records writes, signs predictably. */
const stored = new Map<string, Buffer>();
const signed: { key: string; expiresInSeconds: number }[] = [];
const fakeStorage: StorageService = {
  async putObject({ key, body }) {
    stored.set(key, body);
    return { checksumSha256: 'fake' };
  },
  async getObject({ key }) {
    return {
      key,
      body: stored.get(key)!,
      contentType: 'text/csv',
      checksumSha256: 'fake',
    };
  },
  async headObject() {
    return { checksumSha256: 'fake', contentLength: 0 };
  },
  async deleteObject({ key }) {
    stored.delete(key);
  },
  presignedGetUrl({ key, expiresInSeconds }) {
    signed.push({ key, expiresInSeconds });
    return `https://files.test/${key}?signed`;
  },
};

const days = [d('2026-10-01'), d('2026-10-02'), d('2026-10-03')];

describe.skipIf(!enabled)('attendance API (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    registerAttendancePolicies();
    __setStorageService(fakeStorage);
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`AP${ORG.slice(0, 6)}`}, 'API Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'departments',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${OPS}, ${ORG}, 'OPS', 'Operations', 'operations'), (${SALES}, ${ORG}, 'SAL', 'Sales', 'sales')`,
    );
    await asOwner(
      'positions',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS.admin}, ${ORG}, ${OPS}, 'ADM', 'HR admin', 50),
                 (${POS.manager}, ${ORG}, ${OPS}, 'MGR', 'Manager', 40),
                 (${POS.staff}, ${ORG}, ${OPS}, 'STF', 'Staff', 20),
                 (${POS.seller}, ${ORG}, ${SALES}, 'SEL', 'Seller', 20)`,
    );
    const grants: [string, string][] = [
      [POS.admin, 'all-people'],
      [POS.manager, 'department'],
      [POS.staff, 'own'],
    ];
    for (const [position, scope] of grants) {
      for (const action of ['attendance:view', 'attendance:export']) {
        await asOwner(
          'grant',
          sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
              VALUES (${ORG}, ${position}, ${action}, true, ${scope})`,
        );
      }
    }
    const people: [string, string, string][] = [
      [ADMIN, POS.admin, OPS],
      [MANAGER, POS.manager, OPS],
      [STAFF, POS.staff, OPS],
      [SELLER, POS.seller, SALES],
    ];
    for (const [index, [id, position, department]] of people.entries()) {
      await asOwner(
        'person',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-AP${index}`}, ${`p${index}-${id}@t.io`}, ${`Person ${index}`},
                    ${position}, ${department})`,
      );
    }
    // Three days each for everyone but the administrator.
    for (const userId of [MANAGER, STAFF, SELLER]) {
      for (const day of days)
        await db.transaction(system(), (tx) => openDay(tx, userId, day));
    }
  });

  afterAll(async () => {
    __resetStorageService();
    await closePools();
  });

  const listed = async (ctx: ReturnType<typeof as>, userId?: string) =>
    (
      await listRecords(ctx, {
        from: days[0]!,
        to: days[2]!,
        ...(userId === undefined ? {} : { userId }),
      })
    ).records.map((record) => `${record.userId}:${record.workDate}`);

  it('lists the stored days the caller’s scope reaches, and no others', async () => {
    expect(await listed(admin())).toHaveLength(9);
    const byManager = await listed(manager());
    expect(byManager).toHaveLength(6);
    expect(byManager.every((key) => !key.startsWith(SELLER))).toBe(true);
    expect(await listed(staff())).toEqual(days.map((day) => `${STAFF}:${day}`));
    expect(await listed(admin(), SELLER)).toEqual(days.map((day) => `${SELLER}:${day}`));
    // A day that is not calculated yet says so.
    const [first] = (await listRecords(staff(), { from: days[0]!, to: days[0]! }))
      .records;
    expect(first).toMatchObject({
      recalculating: true,
      status: null,
      dayType: 'working',
    });
  });

  it('AT-13: over 92 days is 422 ATTENDANCE_RANGE_TOO_LONG, pointing to the export', async () => {
    await expect(
      listRecords(admin(), { from: d('2026-01-01'), to: d('2026-04-03') }),
    ).rejects.toMatchObject({
      status: 422,
      code: 'ATTENDANCE_RANGE_TOO_LONG',
      details: { maxDays: 92, export: '/api/attendance/export' },
    });
    await expect(
      listRecords(admin(), { from: d('2026-01-01'), to: d('2026-04-02') }),
    ).resolves.toBeDefined();
  });

  it('a day’s detail is checked against its person: own, department and all-people', async () => {
    const check = async (ctx: ReturnType<typeof as>, userId: string) =>
      authorize(ctx, 'attendance:view', (await loadAttendanceSubject(ctx, userId))!);
    await expect(check(staff(), STAFF)).resolves.toBeUndefined();
    await expect(check(staff(), MANAGER)).rejects.toThrow();
    await expect(check(manager(), STAFF)).resolves.toBeUndefined();
    await expect(check(manager(), SELLER)).rejects.toThrow();
    await expect(check(admin(), SELLER)).resolves.toBeUndefined();
    expect(await loadAttendanceSubject(admin(), randomUUID())).toBeNull();
  });

  describe('export', () => {
    it('userIds only narrow: naming someone outside your scope is 403, and nothing is recorded', async () => {
      await expect(
        requestExport(staff(), { from: days[0]!, to: days[2]!, userIds: [SELLER] }),
      ).rejects.toMatchObject({ status: 403, code: 'ATTENDANCE_EXPORT_EMPTY_SCOPE' });
      const [row] = (await asOwner(
        'count requests',
        sql`SELECT count(*)::int AS n FROM attendance_export_request WHERE requested_by = ${STAFF}`,
      )) as { n: number }[];
      expect(row!.n).toBe(0);
      // Without userIds the same person exports themselves.
      const own = await requestExport(staff(), { from: days[0]!, to: days[2]! });
      const [frozen] = (await asOwner(
        'read frozen people',
        sql`SELECT user_ids::text[] AS user_ids FROM attendance_export_request WHERE id = ${own.jobId}`,
      )) as { userIds: string[] }[];
      expect(frozen!.userIds).toEqual([STAFF]);
    });

    it('queues, freezes who is in it, audits, and signs a link only once the file exists', async () => {
      const queued = await requestExport(manager(), { from: days[0]!, to: days[2]! });
      expect(queued).toEqual({ jobId: expect.any(String), status: 'queued' });
      const jobId = queued.jobId;

      const [audit] = (await asOwner(
        'read audit',
        sql`SELECT payload FROM audit_outbox WHERE organization_id = ${ORG} AND payload->>'targetId' = ${jobId}`,
      )) as { payload: Record<string, unknown> }[];
      expect(audit!.payload).toMatchObject({
        action: 'attendance:export',
        actorId: MANAGER,
        targetType: 'attendanceExport',
        after: { from: '2026-10-01', to: '2026-10-03', people: 3 },
      });
      const [event] = (await asOwner(
        'read outbox',
        sql`SELECT payload FROM domain_outbox
            WHERE organization_id = ${ORG} AND event_name = 'attendance.export-requested'
              AND payload->>'requestId' = ${jobId}`,
      )) as { payload: unknown }[];
      expect(event).toBeDefined();

      // Before the job runs: its status, and no link.
      expect(await getExportStatus(manager(), jobId)).toMatchObject({
        status: 'queued',
        downloadUrl: null,
      });
      // Someone else's export does not exist for them; an administrator sees it.
      await expect(getExportStatus(staff(), jobId)).rejects.toMatchObject({
        status: 404,
        code: 'ATTENDANCE_EXPORT_NOT_FOUND',
      });
      await expect(getExportStatus(admin(), jobId)).resolves.toMatchObject({ jobId });

      // STAFF moves to sales after the request: still in the export (frozen).
      await asOwner(
        'move staff to sales',
        sql`UPDATE app_user SET department_id = ${SALES}, position_id = ${POS.seller} WHERE id = ${STAFF}`,
      );
      expect(await runExport(system(), jobId, false)).toBe(6);

      const done = await getExportStatus(manager(), jobId);
      expect(done).toMatchObject({ status: 'completed', rowCount: 6 });
      expect(done.downloadUrl).toBe(
        `https://files.test/attendance-exports/${ORG}/${jobId}.csv?signed`,
      );
      expect(signed.at(-1)).toEqual({
        key: `attendance-exports/${ORG}/${jobId}.csv`,
        expiresInSeconds: DOWNLOAD_LINK_SECONDS,
      });

      const csv = stored.get(`attendance-exports/${ORG}/${jobId}.csv`)!.toString('utf8');
      const lines = csv.trimEnd().split('\r\n');
      expect(`${lines[0]}\r\n`).toBe(CSV_HEADER);
      expect(lines[0]!.split(',')).toEqual([...EXPORT_COLUMNS]);
      expect(lines).toHaveLength(7);
      const people = new Set(lines.slice(1).map((line) => line.split(',')[0]));
      expect(people).toEqual(new Set([MANAGER, STAFF]));

      // A completed export is never written again.
      stored.clear();
      expect(await runExport(system(), jobId, false)).toBe(0);
      expect(stored.size).toBe(0);
    });
  });
});
