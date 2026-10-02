import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb, type Tx } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { toDateOnly } from '../../platform/time.js';
import { appendEvent } from './facade.js';
import {
  ensureDayRecord,
  openDay,
  openDaysForOrganization,
  withOrganizationDayOpenLease,
} from './day-open.js';
import * as repo from './repository.js';

/**
 * Step 3c day-open (§8.6): single-record materialisation, strictly idempotent,
 * plays nicely with 3a's punch-created records.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const USER = randomUUID();
const NIGHT = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

const date = toDateOnly;
const ist = (local: string) => new Date(`${local}+05:30`);

interface RecordRow {
  id: string;
  inputVersion: number;
  inputChangedAt: string;
  shiftSource: string;
  dayType: string;
  windowStart: string;
  windowEnd: string;
  closeDueAt: string;
  placementSnapshot: { departmentId: string | null; teamId: string | null };
}
async function recordOn(userId: string, day: string): Promise<RecordRow | null> {
  const rows = (await asOwner(
    'read record',
    sql`
    SELECT id, input_version, input_changed_at::text AS input_changed_at, shift_source, day_type,
           window_start::text AS window_start, window_end::text AS window_end,
           close_due_at::text AS close_due_at, placement_snapshot
    FROM attendance_record WHERE user_id = ${userId} AND work_date = ${day}
  `,
  )) as RecordRow[];
  return rows[0] ?? null;
}

async function recalcCount(userId: string, day: string): Promise<number> {
  const rows = (await asOwner(
    'count recalc',
    sql`
    SELECT count(*)::int AS n FROM domain_outbox
    WHERE organization_id = ${ORG}
      AND event_name = 'attendance.recalc-requested'
      AND payload->>'userId' = ${userId}
      AND payload->>'workDate' = ${day}
  `,
  )) as { n: number }[];
  return rows[0]!.n;
}

describe.skipIf(!enabled)('attendance day-open (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`DO${ORG.slice(0, 6)}`}, 'Day-open', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'create position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20)`,
    );
    for (const [i, id] of [HR, USER].entries()) {
      await asOwner(
        'create person',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-DO${String(i).padStart(3, '0')}`},
                    ${`p${i}-${id}@t.io`}, ${`Person ${i}`}, ${POS}, ${DEPT})`,
      );
    }
    await asOwner(
      'shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${NIGHT}, ${ORG}, 'NIGHT', 'Night', 'fixed', ${HR})`,
    );
    await asOwner(
      'version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${NIGHT}, '2026-01-01', '20:00', '05:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'assignment',
      sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
          VALUES (${ORG}, ${USER}, 'template', ${NIGHT}, '2026-09-01', ${HR})`,
    );
    await asOwner(
      'setting',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'attendance_event_assignment',
      'attendance_record',
      'attendance_day_open_state',
      'shift_setting',
      'shift_assignment',
      'shift_version',
      'shift',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner(
      'clear voids',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL`,
    );
    await asOwner(
      'clear events',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear directory',
      sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear people',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear position',
      sql`DELETE FROM position WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear department',
      sql`DELETE FROM department WHERE organization_id = ${ORG}`,
    );
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('creates a fresh day, snapshots facts, writes one recalc event', async () => {
    const day = '2026-10-05';
    const result = await db.transaction(ctx(), (tx) => openDay(tx, USER, date(day)));
    expect(result).toEqual({ created: true });

    const row = await recordOn(USER, day);
    expect(row).not.toBeNull();
    expect(row!.inputVersion).toBe(1);
    expect(row!.shiftSource).toBe('template');
    expect(row!.dayType).toBe('working');
    expect(row!.placementSnapshot.departmentId).toBe(DEPT);

    expect(await recalcCount(USER, day)).toBe(1);
  });

  it('is a true no-op when the record already exists (idempotent)', async () => {
    const day = '2026-10-06';
    await db.transaction(ctx(), (tx) => openDay(tx, USER, date(day)));
    const before = await recordOn(USER, day);
    const beforeCount = await recalcCount(USER, day);

    const result = await db.transaction(ctx(), (tx) => openDay(tx, USER, date(day)));
    expect(result).toEqual({ created: false });

    const after = await recordOn(USER, day);
    expect(after!.id).toBe(before!.id);
    expect(after!.inputVersion).toBe(before!.inputVersion);
    expect(after!.inputChangedAt).toBe(before!.inputChangedAt);
    expect(await recalcCount(USER, day)).toBe(beforeCount);
  });

  it("leaves a punch-created record's inputs alone", async () => {
    const day = '2026-10-07';
    // 3a's appendEvent creates the record with its own snapshot.
    await db.transaction(ctx(), (tx) =>
      appendEvent(tx, {
        userId: USER,
        kind: 'in',
        at: ist(`${day}T19:55:00`), // arrives inside the 20:00 night's window
        source: 'web',
        evidence: 'confirmed',
        remote: true,
      }),
    );
    const before = await recordOn(USER, day);
    expect(before).not.toBeNull();
    const beforeCount = await recalcCount(USER, day);

    const result = await db.transaction(ctx(), (tx) => openDay(tx, USER, date(day)));
    expect(result).toEqual({ created: false });

    const after = await recordOn(USER, day);
    expect(after!.id).toBe(before!.id);
    expect(after!.inputVersion).toBe(before!.inputVersion);
    expect(await recalcCount(USER, day)).toBe(beforeCount);
  });

  it('returns { created: false } for an inactive person and writes nothing', async () => {
    const INACTIVE = randomUUID();
    await asOwner(
      'inactive person',
      sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id, status)
          VALUES (${INACTIVE}, ${ORG}, 'employee', 'EMP-INACT', ${`i-${INACTIVE}@t.io`}, 'Inactive', ${POS}, ${DEPT}, 'inactive')`,
    );
    const result = await db.transaction(ctx(), (tx) =>
      openDay(tx, INACTIVE, date('2026-10-10')),
    );
    expect(result).toEqual({ created: false });
    expect(await recordOn(INACTIVE, '2026-10-10')).toBeNull();
    expect(await recalcCount(INACTIVE, '2026-10-10')).toBe(0);
  });

  describe('openDaysForOrganization (§8.6 orchestrator)', () => {
    it('advances the watermark and creates records for every active person', async () => {
      const from = date('2026-11-01');
      const to = date('2026-11-03');
      const result = await openDaysForOrganization(ctx(), from, to);
      expect(result).toMatchObject({
        materialisedThrough: '2026-11-03',
        firstFailedDate: null,
      });
      // Every active person has a row for every date in the range.
      const rows = (await asOwner(
        'count records in range',
        sql`
          SELECT count(*)::int AS n FROM attendance_record
          WHERE organization_id = ${ORG} AND work_date BETWEEN ${from} AND ${to}
        `,
      )) as { n: number }[];
      const activeCount = (await asOwner(
        'count active people',
        sql`SELECT count(*)::int AS n FROM app_user
            WHERE organization_id = ${ORG} AND account_type = 'employee' AND status IN ('active', 'locked')`,
      )) as { n: number }[];
      expect(rows[0]!.n).toBe(activeCount[0]!.n * 3);

      const state = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(state).toMatchObject({
        materialisedThrough: '2026-11-03',
        lastFailedDate: null,
        leaseAcquiredAt: null,
      });
    });

    it('guard A: stops short of the first date someone could not be opened; the next run finishes it', async () => {
      const [d1, d2, d3] = [date('2027-01-05'), date('2027-01-06'), date('2027-01-07')];
      const failOnD2 = (tx: Tx, userId: string, day: DateOnly) => {
        if (userId === USER && day === d2) throw new Error('simulated failure');
        return openDay(tx, userId, day);
      };
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const first = await openDaysForOrganization(ctx(), d1, d3, { openOne: failOnD2 });
      errors.mockRestore();
      expect(first).toEqual({
        materialisedThrough: '2027-01-05',
        firstFailedDate: '2027-01-06',
      });
      expect(await recordOn(USER, d2)).toBeNull(); // only that person's day rolled back
      expect(await recordOn(HR, d2)).not.toBeNull(); // everyone else on that date committed
      expect(await recordOn(HR, d3)).toBeNull(); // nothing after the failed date
      const stopped = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(stopped).toMatchObject({ lastFailedDate: '2027-01-06', leaseHolder: null });

      const second = await openDaysForOrganization(ctx(), d2, d3);
      expect(second).toEqual({
        materialisedThrough: '2027-01-07',
        firstFailedDate: null,
      });
      expect(await recordOn(USER, d2)).not.toBeNull();
      const finished = await db.transaction(ctx(), (tx) =>
        repo.readDayOpenState(tx, ORG),
      );
      expect(finished!.lastFailedDate).toBeNull();
    });

    it('opens days for employees only', async () => {
      const SERVICE = randomUUID();
      await asOwner(
        'a service account',
        sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
            VALUES (${SERVICE}, ${ORG}, 'service', ${`svc-${SERVICE}@t.io`}, 'Integration')`,
      );
      await openDaysForOrganization(ctx(), date('2027-01-08'), date('2027-01-08'));
      expect(await recordOn(SERVICE, '2027-01-08')).toBeNull();
      expect(await recordOn(USER, '2027-01-08')).not.toBeNull();
    });

    it('a fresh organization starts at yesterday in its own timezone, so nothing older is invented', async () => {
      await asOwner(
        'forget the state row',
        sql`DELETE FROM attendance_day_open_state WHERE organization_id = ${ORG}`,
      );
      await db.transaction(ctx(), (tx) => repo.ensureDayOpenStateRow(tx, ORG));
      const [expected] = (await asOwner(
        "Kolkata's yesterday",
        sql`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text AS day`,
      )) as { day: string }[];
      const state = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(state!.materialisedThrough).toBe(expected!.day);
    });

    it('guard A surface: a manually recorded failure persists on the state row', async () => {
      // Verifying the STATE machinery: after `recordDayOpenFailure(D)`, the
      // state row carries `last_failed_date = D` and it is not cleared
      // except by an explicit `clearDayOpenFailure` call. In-run failure
      // paths are exercised by the fixture-month test in Task 10 (which
      // punches with real shifts and shows the whole loop in action).
      const D = date('2026-11-15');
      await db.transaction(ctx(), (tx) => repo.recordDayOpenFailure(tx, ORG, D));

      const state1 = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(state1!.lastFailedDate).toBe('2026-11-15');

      await db.transaction(ctx(), (tx) => repo.clearDayOpenFailure(tx, ORG));
      const state2 = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(state2!.lastFailedDate).toBeNull();
    });

    it('is a no-op when the lease is already held (concurrent-run guard)', async () => {
      // Simulate a paused Run A by manually setting lease_acquired_at to now.
      await db.transaction(ctx(), async (tx) => {
        await repo.ensureDayOpenStateRow(tx, ORG);
        const ok = await repo.tryAcquireDayOpenLease(tx, ORG, 'run-A');
        expect(ok).toBe(true);
      });
      // Run B tries to take the lease and finds it held.
      const result = await openDaysForOrganization(
        ctx(),
        date('2026-12-01'),
        date('2026-12-03'),
      );
      expect(result).toEqual({ skipped: 'lease-held' });

      // Run B did not touch the watermark or the failure column.
      const state = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(state!.leaseHolder).toBe('run-A');

      // Release Run A's lease; a subsequent run works.
      await db.transaction(ctx(), (tx) => repo.releaseDayOpenLease(tx, ORG));
      const after = await openDaysForOrganization(
        ctx(),
        date('2026-12-01'),
        date('2026-12-03'),
      );
      expect(after).toMatchObject({ firstFailedDate: null });
    });

    it('withOrganizationDayOpenLease releases the lease after the body throws', async () => {
      // Ensure lease is free.
      await db.transaction(ctx(), (tx) => repo.releaseDayOpenLease(tx, ORG));

      await expect(
        withOrganizationDayOpenLease(ctx(), async () => {
          throw new Error('body failed');
        }),
      ).rejects.toThrow('body failed');

      const state = await db.transaction(ctx(), (tx) => repo.readDayOpenState(tx, ORG));
      expect(state!.leaseHolder).toBeNull();
      expect(state!.leaseAcquiredAt).toBeNull();
    });
  });

  it('ensureDayRecord({ emitRecalc: false }) writes the row without a recalc event', async () => {
    const day = '2026-10-08';
    const result = await db.transaction(ctx(), (tx) =>
      ensureDayRecord(tx, USER, date(day), { emitRecalc: false }),
    );
    expect(result.created).toBe(true);
    expect(await recordOn(USER, day)).not.toBeNull();
    expect(await recalcCount(USER, day)).toBe(0);
  });
});
