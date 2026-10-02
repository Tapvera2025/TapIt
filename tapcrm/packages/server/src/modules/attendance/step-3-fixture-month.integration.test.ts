import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DateOnly } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { addDays, toDateOnly, weekdayOf } from '../../platform/time.js';
import { staleRecordIds } from './db.test-helpers.js';
import { openDaysForOrganization } from './day-open.js';
import { appendEvent, applyOverlay, retireEvent } from './facade.js';
import { recalculateRecord } from './recalculate.js';

/**
 * Step 3's done-when (§8.7): a fixture month produces exactly the stored
 * records in the expected table, and replaying any day — including after
 * voiding and restoring a punch — gives identical output.
 *
 * The month is `step-3-fixture-month.json`: two people, their punches, leave
 * and WFH, and the answer expected for every day. It runs through the real
 * path: day-open, the ledger (3a), overlays, and the calculator (3b). Days are
 * closed at the end the way step 7's auto-close will close them, so a day
 * nobody punched becomes absent rather than waiting.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */

type Units = [number, number, number, number, number];
interface Expected {
  status: string;
  units: Units;
  worked: number;
  late: number;
  earlyExit: number;
  overtime: number;
  night: number;
  flags: string[];
}
interface Pattern {
  punches: ['in' | 'out', string][];
  overlay?: 'leave-full' | 'wfh';
  expect: Expected;
}
interface Person {
  shift: { start: string; end: string };
  default: string;
  days: Record<string, string>;
  patterns: Record<string, Pattern>;
}
interface Fixture {
  month: { from: string; to: string };
  weekOff: number[];
  holidays: string[];
  nightWindow: { from: string; to: string };
  people: Record<string, Person>;
}

const fixture = JSON.parse(
  readFileSync(new URL('./step-3-fixture-month.json', import.meta.url), 'utf8'),
) as Fixture;

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const OPS = randomUUID();
const POS = randomUUID();
const ADMIN = randomUUID(); // a service account: it sets things up and has no days
const ids: Record<string, { user: string; shift: string }> = Object.fromEntries(
  Object.keys(fixture.people).map((name) => [
    name,
    { user: randomUUID(), shift: randomUUID() },
  ]),
);
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

const CONNECTOR = randomUUID();
const DEVICE = randomUUID();

/** A device event names the raw punch it came from (0058): one, as the pipeline would have mapped it. */
async function devicePunch(userId: string, at: Date): Promise<string> {
  const id = randomUUID();
  await asOwner(
    'receive a punch',
    sql`
    INSERT INTO biometric_punch (id, organization_id, device_id, pin, occurred_at, corrected_at,
                                 applied_offset_seconds, raw_line, direction_at_receipt, meaning,
                                 dry_run_at_receipt, user_id)
    VALUES (${id}, ${ORG}, ${DEVICE}, ${id.slice(0, 8)}, ${at}, ${at}, 0, 'fixture', 'undirected',
            'scan', false, ${userId})`,
  );
  return id;
}

/** The approved leave or WFH request an overlay stands for: one per day, as leave writes them. */
const leaveTypes = new Map<string, string>();
async function approvedRequest(userId: string, kind: 'absence' | 'attendance-mode', day: DateOnly): Promise<string> {
  let typeId = leaveTypes.get(kind);
  if (typeId === undefined) {
    typeId = randomUUID();
    await asOwner(
      'a leave type',
      sql`INSERT INTO leave_type (id, organization_id, code, name, kind, enforcement, paid_leave, created_by)
          VALUES (${typeId}, ${ORG}, ${kind === 'absence' ? 'AL' : 'WFH'}, ${kind === 'absence' ? 'Annual' : 'Work from home'},
                  ${kind}, false, ${kind === 'absence'}, ${ADMIN})`,
    );
    leaveTypes.set(kind, typeId);
  }
  const id = randomUUID();
  await asOwner(
    'the request',
    sql`INSERT INTO leave_request (id, organization_id, user_id, leave_type_id, kind, from_date, to_date, reason, requested_by)
        VALUES (${id}, ${ORG}, ${userId}, ${typeId}, ${kind}, ${day}, ${day}, 'Fixture month', ${userId})`,
  );
  return id;
}

function monthDates(): DateOnly[] {
  const out: DateOnly[] = [];
  for (
    let day = toDateOnly(fixture.month.from);
    day <= fixture.month.to;
    day = addDays(day, 1)
  )
    out.push(day);
  return out;
}

/** Which pattern a person follows on a date: the calendar first, then the table, then the default. */
function patternOn(person: Person, date: DateOnly): string {
  if (fixture.weekOff.includes(weekdayOf(date))) return 'week-off';
  if (fixture.holidays.includes(date)) return 'holiday';
  return person.days[date] ?? person.default;
}

/** Calculates every stale day, as the queue would, until nothing is left. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    const stale = await staleRecordIds(ORG);
    if (stale.length === 0) return;
    for (const id of stale)
      await db.transaction(ctx(), (tx) => recalculateRecord(tx, id));
  }
  throw new Error('days kept going stale');
}

interface Stored {
  workDate: string;
  dayType: string;
  status: string | null;
  presentUnits: number;
  paidLeaveUnits: number; // a half-day count, not money (CI-21)
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  flags: string[];
}

async function storedMonth(
  userId: string,
): Promise<Map<string, Expected & { dayType: string }>> {
  const rows = (await asOwner(
    'read the month',
    sql`
    SELECT work_date::text AS work_date, day_type, status, present_units, paid_leave_units,
           unpaid_leave_units, absent_units, holiday_units, worked_minutes, late_minutes,
           early_exit_minutes, overtime_minutes, night_minutes, flags
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date BETWEEN ${fixture.month.from} AND ${fixture.month.to}
    ORDER BY work_date`,
  )) as Stored[];
  return new Map(
    rows.map((row) => [
      row.workDate,
      {
        dayType: row.dayType,
        status: row.status ?? 'none',
        units: [
          row.presentUnits,
          row.paidLeaveUnits,
          row.unpaidLeaveUnits,
          row.absentUnits,
          row.holidayUnits,
        ],
        worked: row.workedMinutes,
        late: row.lateMinutes,
        earlyExit: row.earlyExitMinutes,
        overtime: row.overtimeMinutes,
        night: row.nightMinutes,
        flags: [...row.flags].sort(),
      },
    ]),
  );
}

/** The expected table, day by day, with the calendar's day type. */
function expectedMonth(person: Person): Map<string, Expected & { dayType: string }> {
  return new Map(
    monthDates().map((date) => {
      const name = patternOn(person, date);
      const dayType =
        name === 'week-off' ? 'week-off' : name === 'holiday' ? 'holiday' : 'working';
      const expected = person.patterns[name]!.expect;
      return [date, { dayType, ...expected, flags: [...expected.flags].sort() }];
    }),
  );
}

async function expectMonthAsSignedOff(): Promise<void> {
  for (const [name, person] of Object.entries(fixture.people)) {
    const stored = await storedMonth(ids[name]!.user);
    const expected = expectedMonth(person);
    expect(stored.size, `${name}: one record per date`).toBe(expected.size);
    for (const [date, row] of expected) {
      expect(stored.get(date), `${name} on ${date}`).toEqual(row);
    }
  }
}

describe.skipIf(!enabled)('step 3 fixture month (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`FM${ORG.slice(0, 6)}`}, 'Fixture Month', 'Asia/Kolkata')`,
    );
    await asOwner(
      'department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${OPS}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${POS}, ${ORG}, ${OPS}, 'OPS-1', 'Operator', 20)`,
    );
    await asOwner(
      'administrator',
      sql`INSERT INTO app_user (id, organization_id, account_type, email, full_name)
          VALUES (${ADMIN}, ${ORG}, 'service', ${`admin-${ADMIN}@t.io`}, 'Setup')`,
    );
    await asOwner(
      'the office connector',
      sql`INSERT INTO biometric_connector (id, organization_id, kind, name, created_by)
          VALUES (${CONNECTOR}, ${ORG}, 'zk-adms', 'Office', ${ADMIN})`,
    );
    await asOwner(
      'the office device',
      sql`INSERT INTO biometric_device (id, organization_id, connector_id, serial_number, name, timezone, created_by)
          VALUES (${DEVICE}, ${ORG}, ${CONNECTOR}, ${`FM${ORG.slice(0, 8)}`}, 'Front door', 'Asia/Kolkata', ${ADMIN})`,
    );
    for (const [index, [name, person]] of Object.entries(fixture.people).entries()) {
      const { user, shift } = ids[name]!;
      await asOwner(
        'person',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${user}, ${ORG}, 'employee', ${`EMP-FM${index}`}, ${`${name}-${user}@t.io`}, ${name}, ${POS}, ${OPS})`,
      );
      await asOwner(
        'shift',
        sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by)
            VALUES (${shift}, ${ORG}, ${name.toUpperCase()}, ${name}, 'fixed', ${ADMIN})`,
      );
      // Ten minutes' grace, 450 a full day, 240 a half, overtime from 30 minutes.
      await asOwner(
        'version',
        sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                       full_day_minutes, half_day_minutes, min_overtime_minutes, created_by)
            VALUES (${ORG}, ${shift}, '2027-01-01', ${person.shift.start}, ${person.shift.end}, 10, 450, 240, 30, ${ADMIN})`,
      );
      await asOwner(
        'template',
        sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
            VALUES (${ORG}, ${user}, 'template', ${shift}, '2027-01-01', ${ADMIN})`,
      );
    }
    await asOwner(
      'a four-hour closing extension',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2027-01-01', 240, ${ADMIN})`,
    );
    await asOwner(
      'the night window',
      sql`INSERT INTO attendance_setting (organization_id, effective_from, night_window_from, night_window_to, created_by)
          VALUES (${ORG}, '2027-01-01', ${fixture.nightWindow.from}, ${fixture.nightWindow.to}, ${ADMIN})`,
    );
    await asOwner(
      'the week-off rule',
      sql`INSERT INTO holiday (organization_id, name, type, recurrence, effective_from, created_by)
          VALUES (${ORG}, 'Weekly off', 'week-off', ${JSON.stringify({ weekdays: fixture.weekOff })}::jsonb,
                  '2027-01-01', ${ADMIN})`,
    );
    for (const holiday of fixture.holidays) {
      await asOwner(
        'a national holiday',
        sql`INSERT INTO holiday (organization_id, name, type, holiday_date, created_by)
            VALUES (${ORG}, 'National holiday', 'national', ${holiday}, ${ADMIN})`,
      );
    }

    // 1. Day-open builds the month.
    const opened = await openDaysForOrganization(
      ctx(),
      toDateOnly(fixture.month.from),
      toDateOnly(fixture.month.to),
    );
    expect(opened).toMatchObject({
      materialisedThrough: fixture.month.to,
      firstFailedDate: null,
    });

    // 2. The month's punches and overlays, as leave and the devices would send them.
    for (const [name, person] of Object.entries(fixture.people)) {
      const userId = ids[name]!.user;
      for (const date of monthDates()) {
        const pattern = person.patterns[patternOn(person, date)]!;
        if (pattern.overlay !== undefined) {
          const overlay = pattern.overlay;
          // An overlay points at the approved request behind it (leave's key, step 6).
          const sourceId = await approvedRequest(userId, overlay === 'wfh' ? 'attendance-mode' : 'absence', date);
          await db.transaction(ctx(), (tx) =>
            applyOverlay(tx, {
              sourceKind: overlay === 'wfh' ? 'wfh' : 'leave',
              sourceId,
              userId,
              workDate: date,
              kind: overlay,
              ...(overlay === 'leave-full' ? { paid: true } : {}),
            }),
          );
        }
        for (const [kind, time] of pattern.punches) {
          const next = kind === 'out' && time < pattern.punches[0]![1];
          const at = ist(next ? addDays(date, 1) : date, time);
          const source =
            pattern.overlay === 'wfh'
              ? { source: 'web' as const, remote: true }
              : {
                  source: 'device' as const,
                  biometricPunchId: await devicePunch(userId, at),
                };
          await db.transaction(ctx(), (tx) =>
            appendEvent(tx, { userId, kind, at, evidence: 'confirmed', ...source }),
          );
        }
      }
    }

    // 3. Close the month, as step 7's auto-close will, and calculate everything.
    await asOwner(
      'close the month',
      sql`UPDATE attendance_record
          SET state = 'closed', closed_at = now(), closed_by = 'auto-close',
              input_version = input_version + 1, input_changed_at = now()
          WHERE organization_id = ${ORG}`,
    );
    await settle();
  }, 120_000);

  afterAll(async () => {
    await closePools();
  });

  it('produces exactly the stored records in the signed-off table', async () => {
    await expectMonthAsSignedOff();
  });

  it('replaying every day gives identical output', async () => {
    await asOwner(
      'ask for every day again',
      sql`UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now()
          WHERE organization_id = ${ORG}`,
    );
    await settle();
    await expectMonthAsSignedOff();
  });

  it('voiding and restoring a punch gives identical output', async () => {
    const night = ids['night']!.user;
    const date = '2027-02-17';
    const [out] = (await asOwner(
      "the night's departure",
      sql`SELECT e.id FROM attendance_event e
          JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
          JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
          WHERE r.user_id = ${night} AND r.work_date = ${date} AND e.kind = 'out' AND NOT e.is_void`,
    )) as { id: string }[];

    await db.transaction(ctx(), (tx) => retireEvent(tx, out!.id));
    await settle();
    const voided = (await storedMonth(night)).get(date)!;
    // Without its departure the day is open again: the departure had closed it
    // (closed_by = punch-out), and the fixture month is still ahead of us, so
    // the closing time has not come. An open day is not judged yet.
    expect(voided).toMatchObject({ status: 'none', worked: 0, flags: [] });

    const at = ist('2027-02-18', '05:05');
    const biometricPunchId = await devicePunch(night, at);
    await db.transaction(ctx(), (tx) =>
      appendEvent(tx, {
        userId: night,
        kind: 'out',
        at,
        source: 'device',
        evidence: 'confirmed',
        biometricPunchId,
      }),
    );
    await settle();
    await expectMonthAsSignedOff();
  });
});
