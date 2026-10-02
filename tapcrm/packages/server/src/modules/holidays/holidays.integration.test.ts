import { randomUUID } from 'node:crypto';
import type { Principal } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock, toDateOnly } from '../../platform/time.js';
import { registerHolidayPolicies } from './policy.js';
import { createHoliday, listHolidays, reviseHoliday } from './service.js';

/**
 * Step 2 through the services, against real PostgreSQL: RLS, the event
 * payloads (HO-3), the policies, and blast-radius rules (§7).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT_A = randomUUID();
const DEPT_B = randomUUID();
const POS_HR = randomUUID();
const POS_HR_CORRECT = randomUUID();
const EMP_A = randomUUID();
const EMP_B = randomUUID();
const HR = randomUUID();
const HR_CORRECT = randomUUID();
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

// Friday 25 September 2026, 11:30 in Kolkata.
const clock = fixedClock('2026-09-25T06:00:00Z');
const date = toDateOnly;

function hrContext(userId: string, positionId: string) {
  const principal: Principal = {
    id: userId,
    organizationId: ORG,
    sessionVersion: 1,
    accountType: 'employee',
    positionId,
    departmentId: DEPT_A,
    teamId: null,
    reportsTo: null,
    organizationalLevel: 50,
  };
  return createRequestContext({
    organizationId: ORG,
    principal,
    requestId: randomUUID(),
  });
}

const hr = () => hrContext(HR, POS_HR);
const hrWithCorrect = () => hrContext(HR_CORRECT, POS_HR_CORRECT);

const night = randomUUID();

async function latestEvent(): Promise<{
  payload: {
    departmentIds?: string[];
    shiftIds?: string[];
    from: string;
    toExclusive: string | null;
    reason: string;
  };
}> {
  const rows = (await asOwner(
    'read latest holidays event',
    sql`
      SELECT payload FROM domain_outbox WHERE organization_id = ${ORG}
        AND event_name = 'holidays.days-changed'
      ORDER BY enqueued_at DESC LIMIT 1
    `,
  )) as {
    payload: {
      departmentIds?: string[];
      shiftIds?: string[];
      from: string;
      toExclusive: string | null;
      reason: string;
    };
  }[];
  return rows[0]!;
}

describe.skipIf(!enabled)('holidays (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    registerHolidayPolicies();
    await asOwner(
      'create test organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`HO${ORG.slice(0, 6)}`}, 'Holiday Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create departments',
      sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT_A}, ${ORG}, 'DA', 'Dept A', 'operations'),
             (${DEPT_B}, ${ORG}, 'DB', 'Dept B', 'operations')`,
    );
    await asOwner(
      'create positions',
      sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_HR}, ${ORG}, ${DEPT_A}, 'HR-1', 'HR', 50),
             (${POS_HR_CORRECT}, ${ORG}, ${DEPT_A}, 'HR-2', 'HR Lead', 50)`,
    );
    for (const position of [POS_HR, POS_HR_CORRECT]) {
      for (const action of ['holidays:view', 'holidays:manage']) {
        await asOwner(
          'grant policy',
          sql`
          INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
          VALUES (${ORG}, ${position}, ${action}, true, 'all-people')`,
        );
      }
    }
    await asOwner(
      'grant attendance:correct to one position',
      sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${ORG}, ${POS_HR_CORRECT}, 'attendance:correct', true, 'all-people')`,
    );
    await asOwner(
      'create people',
      sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${EMP_A}, ${ORG}, 'employee', 'EMP-HO001', ${`ea-${EMP_A}@t.io`}, 'Emp A', ${POS_HR}, ${DEPT_A}),
             (${EMP_B}, ${ORG}, 'employee', 'EMP-HO002', ${`eb-${EMP_B}@t.io`}, 'Emp B', ${POS_HR}, ${DEPT_B}),
             (${HR}, ${ORG}, 'employee', 'EMP-HO003', ${`hr-${HR}@t.io`}, 'HR One', ${POS_HR}, ${DEPT_A}),
             (${HR_CORRECT}, ${ORG}, 'employee', 'EMP-HO004', ${`hr2-${HR_CORRECT}@t.io`}, 'HR Two', ${POS_HR_CORRECT}, ${DEPT_A})`,
    );

    await asOwner(
      'create test shift (referenced by shift-scoped holiday scope)',
      sql`
      INSERT INTO shift (id, organization_id, code, name, kind, created_by)
      VALUES (${night}, ${ORG}, 'NIGHT', 'Night', 'fixed', ${HR})`,
    );
    await asOwner(
      'create test shift version',
      sql`
      INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time,
                                  grace_minutes, early_exit_grace_minutes, full_day_minutes, half_day_minutes,
                                  early_window_minutes, created_by)
      VALUES (${ORG}, ${night}, '2026-01-01', '20:00', '05:00', 10, 0, 450, 240, 180, ${HR})`,
    );
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'holiday_scope',
      'holiday',
      'shift_override',
      'shift_request',
      'shift_assignment',
      'shift_rotation_day',
      'shift_rotation',
      'department_shift_default',
      'shift_version',
      'shift',
      'position_policy',
    ]) {
      await asOwner(
        `remove ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner(
      'remove directory rows',
      sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`,
    );
    await asOwner('remove people', sql`DELETE FROM app_user WHERE organization_id = ${ORG}`);
    await asOwner('remove positions', sql`DELETE FROM position WHERE organization_id = ${ORG}`);
    await asOwner('remove departments', sql`DELETE FROM department WHERE organization_id = ${ORG}`);
    await asOwner('remove organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('1: create + list + read (HO-4)', async () => {
    const { id } = await createHoliday(
      hr(),
      {
        name: 'Republic Day',
        type: 'national',
        holidayDate: date('2027-01-26'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [],
      },
      clock,
    );
    const listed = await listHolidays(
      hr(),
      { from: date('2027-01-01'), to: date('2027-12-31') },
      clock,
    );
    expect(listed.holidays.some((h) => h.id === id && h.name === 'Republic Day')).toBe(true);
  });

  it('2: create shift-scoped and see it apply only to the night crew — event carries shiftIds', async () => {
    await createHoliday(
      hr(),
      {
        name: 'Night crew eve',
        type: 'regional',
        holidayDate: date('2026-12-31'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [{ departmentId: null, shiftId: night }],
      },
      clock,
    );
    const evt = await latestEvent();
    expect(evt.payload).toMatchObject({
      shiftIds: [night],
      from: '2026-12-31',
      toExclusive: '2027-01-01',
      reason: 'created',
    });
    expect(evt.payload.departmentIds).toBeUndefined();
  });

  it('3: an optional holiday does not turn any day into a holiday (only CRUD changes)', async () => {
    const { id } = await createHoliday(
      hr(),
      {
        name: 'Optional Bhai Dooj',
        type: 'optional',
        holidayDate: date('2026-11-13'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [],
      },
      clock,
    );
    const listed = await listHolidays(
      hr(),
      { from: date('2026-11-01'), to: date('2026-11-30') },
      clock,
    );
    expect(listed.holidays.some((h) => h.id === id)).toBe(true);
    // The resolver's optional-holiday exclusion is verified by resolve.test.ts;
    // this integration case only asserts that the CRUD surface accepts it.
  });

  it('4: withdraw a national holiday — event omits both id sets (organization-wide, HO-3)', async () => {
    const { id } = await createHoliday(
      hr(),
      {
        name: 'Yay Day',
        type: 'national',
        holidayDate: date('2026-10-10'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [],
      },
      clock,
    );
    await reviseHoliday(hr(), id, { status: 'withdrawn' }, clock);
    const evt = await latestEvent();
    expect(evt.payload.reason).toBe('withdrawn');
    expect(evt.payload.departmentIds).toBeUndefined();
    expect(evt.payload.shiftIds).toBeUndefined();
    expect(evt.payload.from).toBe('2026-10-10');
    expect(evt.payload.toExclusive).toBe('2026-10-11');
  });

  it('5: withdraw a shift-scoped holiday — event carries only shiftIds', async () => {
    const { id } = await createHoliday(
      hr(),
      {
        name: 'Night eve 2',
        type: 'regional',
        holidayDate: date('2026-10-15'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [{ departmentId: null, shiftId: night }],
      },
      clock,
    );
    await reviseHoliday(hr(), id, { status: 'withdrawn' }, clock);
    const evt = await latestEvent();
    expect(evt.payload).toMatchObject({
      shiftIds: [night],
      reason: 'withdrawn',
    });
    expect(evt.payload.departmentIds).toBeUndefined();
  });

  it('6: a past-dated change needs attendance:correct', async () => {
    const past = {
      name: 'Old holiday',
      type: 'national' as const,
      holidayDate: date('2026-09-20'),
      recurrence: null,
      effectiveFrom: null,
      effectiveTo: null,
      scopes: [],
    };
    await expect(createHoliday(hr(), past, clock)).rejects.toMatchObject({
      status: 403,
      code: 'HOLIDAY_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
    });
    await expect(createHoliday(hrWithCorrect(), past, clock)).resolves.toBeDefined();
  });

  it('7: outbox carries `from` inclusive and `toExclusive` exclusive; week-off with null effective_to → toExclusive null', async () => {
    await createHoliday(
      hr(),
      {
        name: 'Global Sunday',
        type: 'week-off',
        holidayDate: null,
        recurrence: { weekdays: [7] },
        effectiveFrom: date('2027-01-01'),
        effectiveTo: null,
        scopes: [],
      },
      clock,
    );
    const evt = await latestEvent();
    expect(evt.payload).toMatchObject({
      from: '2027-01-01',
      toExclusive: null,
      reason: 'created',
    });
  });

  it('8: scope-change blast radius dept A → dept B, event carries UNION(A, B)', async () => {
    const { id } = await createHoliday(
      hr(),
      {
        name: 'Regional swap',
        type: 'regional',
        holidayDate: date('2026-11-10'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [{ departmentId: DEPT_A, shiftId: null }],
      },
      clock,
    );
    await reviseHoliday(
      hr(),
      id,
      { scopes: [{ departmentId: DEPT_B, shiftId: null }] },
      clock,
    );
    const evt = await latestEvent();
    expect(evt.payload.reason).toBe('scope-changed');
    expect(new Set(evt.payload.departmentIds ?? [])).toEqual(new Set([DEPT_A, DEPT_B]));
    expect(evt.payload.shiftIds).toBeUndefined();
  });

  it('9: axis switch dept A → shift Night, event carries both departmentIds and shiftIds', async () => {
    const { id } = await createHoliday(
      hr(),
      {
        name: 'Axis switch',
        type: 'regional',
        holidayDate: date('2026-11-05'),
        recurrence: null,
        effectiveFrom: null,
        effectiveTo: null,
        scopes: [{ departmentId: DEPT_A, shiftId: null }],
      },
      clock,
    );
    await reviseHoliday(
      hr(),
      id,
      { scopes: [{ departmentId: null, shiftId: night }] },
      clock,
    );
    const evt = await latestEvent();
    expect(evt.payload.reason).toBe('scope-changed');
    expect(evt.payload.departmentIds).toEqual([DEPT_A]);
    expect(evt.payload.shiftIds).toEqual([night]);
  });
});
