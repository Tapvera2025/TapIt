import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import {
  handledEventNames,
  retriedUntilDelivered,
} from '../../platform/outbox/registry.js';
import { sql } from '../../platform/dal/sql.js';
import { toDateOnly } from '../../platform/time.js';
import { staleRecordIds } from './db.test-helpers.js';
import { openDaysForOrganization, openMissingDays } from './day-open.js';
import { registerAttendanceJobs } from './jobs.js';
import { recalculateRecord, recordRefresh, runRefreshRequest } from './recalculate.js';
import * as repo from './repository.js';

/**
 * The employment window (migration 0060, §8.6) as attendance applies it:
 * days open only inside it, a new joiner gets today's day within the hour,
 * and a moved leaving date re-judges the days it reaches — marked
 * `not-employed`, never deleted.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const LEAVER = randomUUID(); // joined 2 October, leaves 6 October
const STAYER = randomUUID(); // no dates: the account status decides
const LATE = randomUUID(); // joins on 7 October
const SHIFT = randomUUID();
const d = toDateOnly;

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

async function daysOf(userId: string) {
  return (await asOwner(
    'read days',
    sql`SELECT work_date::text AS work_date, status FROM attendance_record
          WHERE user_id = ${userId} ORDER BY work_date`,
  )) as { workDate: string; status: string | null }[];
}

async function settle() {
  for (const id of await staleRecordIds(ORG))
    await db.transaction(ctx(), (tx) => recalculateRecord(tx, id));
}

describe.skipIf(!enabled)('the employment window in attendance (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name, timezone)
          VALUES (${ORG}, ${`EW${ORG.slice(0, 6)}`}, 'Employment window', 'Asia/Kolkata')`,
    );
    await asOwner(
      'department',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${DEPT}, 'OP', 'Operator', 20)`,
    );
    await asOwner(
      'setup account',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${HR}, ${ORG}, 'service', ${`hr-${HR}@t.io`}, 'Setup')`,
    );
    const people: [string, string | null, string | null][] = [
      [LEAVER, '2026-10-02', '2026-10-06'],
      [STAYER, null, null],
      [LATE, '2026-10-07', null],
    ];
    for (const [index, [id, joinedOn, leftOn]] of people.entries()) {
      await asOwner(
        'employee',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id,
                                  department_id, joined_on, left_on)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-EW${index}`}, ${`w${index}-${id}@t.io`}, ${`Person ${index}`},
                    ${POS}, ${DEPT}, ${joinedOn}, ${leftOn})`,
      );
    }
    await asOwner(
      'a day shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
          VALUES (${SHIFT}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'its version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${SHIFT}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'setting',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    for (const [id] of people) {
      await asOwner(
        'template',
        sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
            VALUES (${ORG}, ${id}, 'template', ${SHIFT}, '2026-01-01', ${HR})`,
      );
    }
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'attendance_refresh_request',
      'attendance_event_assignment',
      'attendance_record',
      'attendance_month_summary',
      'attendance_day_open_state',
      'shift_assignment',
      'shift_setting',
      'shift_version',
      'shift',
      'identity_email_directory',
      'app_user',
      'position',
      'department',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('asks who is employed on a date by the window', async () => {
    const employed = (date: string) =>
      db.transaction(ctx(), (tx) => repo.listEmployedUserIds(tx, d(date)));
    expect(await employed('2026-10-01')).toEqual([STAYER]);
    expect((await employed('2026-10-02')).sort()).toEqual([LEAVER, STAYER].sort());
    expect((await employed('2026-10-07')).sort()).toEqual([LATE, STAYER].sort());
  });

  it('opens days only inside the window', async () => {
    await db.transaction(ctx(), (tx) => repo.ensureDayOpenStateRow(tx, ORG));
    await openDaysForOrganization(ctx(), d('2026-10-01'), d('2026-10-06'));
    expect((await daysOf(LEAVER)).map((day) => day.workDate)).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(await daysOf(STAYER)).toHaveLength(6);
    expect(await daysOf(LATE)).toEqual([]);
  });

  it('a joiner gets their day once they are employed on it, and nobody gets a second one', async () => {
    expect(await openMissingDays(ctx(), d('2026-10-07'))).toBe(2); // the late joiner and the stayer
    expect(await openMissingDays(ctx(), d('2026-10-07'))).toBe(0);
    expect((await daysOf(LATE)).map((day) => day.workDate)).toEqual(['2026-10-07']);
  });

  it('a leaving date moved earlier marks the days after it not-employed, and keeps them', async () => {
    await settle();
    await asOwner(
      'HR moves the leaving date',
      sql`UPDATE app_user SET left_on = '2026-10-04' WHERE id = ${LEAVER}`,
    );
    const requests = await db.transaction(ctx(), (tx) =>
      recordRefresh(tx, ORG, randomUUID(), { userIds: [LEAVER] }, d('2026-10-05'), null),
    );
    for (const request of requests) await runRefreshRequest(ctx(), request.id);
    await settle();
    const days = await daysOf(LEAVER);
    expect(days.map((day) => day.workDate)).toHaveLength(5);
    expect(
      days.filter((day) => day.status === 'not-employed').map((day) => day.workDate),
    ).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('attendance listens for the employee directory’s change, and never drops it', () => {
    registerAttendanceJobs();
    expect(handledEventNames()).toContain('employee.employment-changed');
    expect(retriedUntilDelivered()).toContain('employee.employment-changed');
  });
});
