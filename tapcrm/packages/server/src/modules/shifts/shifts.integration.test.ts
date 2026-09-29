import { randomUUID } from 'node:crypto';
import type { Principal } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock, toDateOnly } from '../../platform/time.js';
import { registerShiftPolicies } from './policy.js';
import {
  assign,
  createShift,
  decideRequest,
  explainShifts,
  reviseShift,
} from './service.js';

/**
 * Step 1 through the services, against real PostgreSQL: RLS, the exclusion
 * constraints, the engine and position policies (design §6).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS_HR = randomUUID();
const POS_HR_CORRECT = randomUUID();
const EMP = randomUUID();
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
    departmentId: DEPT,
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

const version = (
  startTime: string | null,
  endTime: string | null,
  effectiveFrom?: string,
) => ({
  ...(effectiveFrom === undefined ? {} : { effectiveFrom: date(effectiveFrom) }),
  startTime: startTime as never,
  endTime: endTime as never,
  graceMinutes: 10,
  earlyExitGraceMinutes: 0,
  fullDayMinutes: 450,
  halfDayMinutes: 240,
  complementaryHalfMinutes: null,
  minOvertimeMinutes: null,
  earlyWindowMinutes: 180,
  maxClosingExtensionMinutes: null,
});

let day = '';
let night = '';
let early = '';

describe.skipIf(!enabled)('shifts (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    registerShiftPolicies();
    await asOwner(
      'create test organization',
      sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SH${ORG.slice(0, 6)}`}, 'Shift Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'create positions',
      sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_HR}, ${ORG}, ${DEPT}, 'HR-1', 'HR', 50), (${POS_HR_CORRECT}, ${ORG}, ${DEPT}, 'HR-2', 'HR Lead', 50)`,
    );
    for (const position of [POS_HR, POS_HR_CORRECT]) {
      for (const action of ['shifts:view', 'shifts:manage', 'shifts:approve']) {
        await asOwner(
          'grant shift policy',
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
      VALUES (${EMP}, ${ORG}, 'employee', 'EMP-SH001', ${`emp-${EMP}@t.io`}, 'Night Worker', ${POS_HR}, ${DEPT}),
             (${HR}, ${ORG}, 'employee', 'EMP-SH002', ${`hr-${HR}@t.io`}, 'HR One', ${POS_HR}, ${DEPT}),
             (${HR_CORRECT}, ${ORG}, 'employee', 'EMP-SH003', ${`hr2-${HR_CORRECT}@t.io`}, 'HR Two', ${POS_HR_CORRECT}, ${DEPT})`,
    );

    day = (
      await createShift(
        hr(),
        { code: 'DAY', name: 'Day', kind: 'fixed', version: version('09:00', '18:00') },
        clock,
      )
    ).id;
    night = (
      await createShift(
        hr(),
        {
          code: 'NIGHT',
          name: 'Night',
          kind: 'fixed',
          version: version('20:00', '05:00'),
        },
        clock,
      )
    ).id;
    early = (
      await createShift(
        hr(),
        {
          code: 'EARLY',
          name: 'Early',
          kind: 'fixed',
          version: version('04:30', '13:30'),
        },
        clock,
      )
    ).id;
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
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
    await asOwner(
      'remove people',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove positions',
      sql`DELETE FROM position WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove department',
      sql`DELETE FROM department WHERE organization_id = ${ORG}`,
    );
    await asOwner('remove organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('done when: the explorer shows the right shift and source for each date', async () => {
    await assign(
      hr(),
      {
        kind: 'template',
        userId: EMP,
        shiftId: day,
        effectiveFrom: date('2026-09-28'),
        effectiveTo: null,
      },
      clock,
    );
    await assign(
      hr(),
      {
        kind: 'override',
        userId: EMP,
        workDate: date('2026-09-30'),
        override: 'shift',
        shiftId: night,
        reason: 'Cover',
      },
      clock,
    );

    const result = await explainShifts(
      hr(),
      { userId: EMP, from: date('2026-09-28'), to: date('2026-10-01') },
      clock,
    );
    if (!('days' in result)) throw new Error('expected days');
    expect(result.days.map((d) => [d.date, d.source, d.start])).toEqual([
      ['2026-09-28', 'template', '09:00'],
      ['2026-09-29', 'template', '09:00'],
      ['2026-09-30', 'date-override', '20:00'],
      ['2026-10-01', 'template', '09:00'],
    ]);
    // The night of the 30th ends 05:00 on the 1st; the 1st starts 09:00, so the boundary is 07:00.
    expect(result.days[2]!.window.end).toBe(
      new Date('2026-10-01T07:00:00+05:30').toISOString(),
    );
  });

  it('SH-2: a new version changes nothing before its date', async () => {
    await reviseShift(
      hr(),
      day,
      { version: version('10:00', '19:00', '2026-10-01') },
      clock,
    );
    const result = await explainShifts(
      hr(),
      { userId: EMP, from: date('2026-09-29'), to: date('2026-10-01') },
      clock,
    );
    if (!('days' in result)) throw new Error('expected days');
    expect(result.days[0]).toMatchObject({ date: '2026-09-29', start: '09:00' });
    expect(result.days[2]).toMatchObject({ date: '2026-10-01', start: '10:00' });
  });

  it('SH-6: a past-dated change needs attendance:correct as well', async () => {
    const pastOverride = {
      kind: 'override' as const,
      userId: EMP,
      workDate: date('2026-09-20'),
      override: 'no-shift' as const,
      shiftId: null,
      reason: 'Was on leave',
    };
    await expect(assign(hr(), pastOverride, clock)).rejects.toMatchObject({
      status: 403,
      code: 'SHIFT_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
    });
    await expect(assign(hrWithCorrect(), pastOverride, clock)).resolves.toBeDefined();
  });

  it('§6.3: a shift that would overlap the night before is refused with SHIFT_WINDOW_OVERLAP', async () => {
    // The night of the 30th ends 05:00 on the 1st; an early shift that day would start at 04:30.
    await expect(
      assign(
        hr(),
        {
          kind: 'override',
          userId: EMP,
          workDate: date('2026-10-01'),
          override: 'shift',
          shiftId: early,
          reason: 'Early start',
        },
        clock,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'SHIFT_WINDOW_OVERLAP' });
  });

  it('SH-5: an inactive template keeps resolving but cannot be newly assigned', async () => {
    await reviseShift(hr(), early, { status: 'inactive' }, clock);
    await expect(
      assign(
        hr(),
        {
          kind: 'template',
          userId: HR,
          shiftId: early,
          effectiveFrom: date('2026-10-05'),
          effectiveTo: null,
        },
        clock,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'SHIFT_INACTIVE' });
  });

  it('an approved change request becomes overrides that point back at it, and tells attendance', async () => {
    const [request] = (await asOwner(
      'raise a request (G3: no route yet)',
      sql`
      INSERT INTO shift_request (organization_id, user_id, kind, from_date, to_date, requested_shift_id, reason, requested_by)
      VALUES (${ORG}, ${EMP}, 'change', '2026-10-12', '2026-10-13', ${night}, 'Swap with a colleague', ${EMP})
      RETURNING id`,
    )) as { id: string }[];

    await expect(
      decideRequest(hr(), request!.id, { decision: 'approve', note: null }, clock),
    ).resolves.toMatchObject({ status: 'approved' });

    const overrides = (await asOwner(
      'read overrides',
      sql`
      SELECT work_date::text AS work_date, shift_id, origin_request_id FROM shift_override
      WHERE organization_id = ${ORG} AND origin_request_id = ${request!.id} ORDER BY work_date`,
    )) as {
      workDate: string;
      shiftId: string;
      originRequestId: string;
    }[];
    expect(overrides.map((o) => [o.workDate, o.shiftId])).toEqual([
      ['2026-10-12', night],
      ['2026-10-13', night],
    ]);

    const events = (await asOwner(
      'read outbox',
      sql`
      SELECT payload FROM domain_outbox WHERE organization_id = ${ORG} AND event_name = 'shifts.days-changed'
      ORDER BY enqueued_at DESC LIMIT 1`,
    )) as { payload: { userIds: string[]; from: string; to: string } }[];
    expect(events[0]!.payload).toMatchObject({
      userIds: [EMP],
      from: '2026-10-12',
      to: '2026-10-13',
    });

    await expect(
      decideRequest(hr(), request!.id, { decision: 'approve', note: null }, clock),
    ).rejects.toMatchObject({
      status: 409,
      code: 'SHIFT_REQUEST_NOT_PENDING',
    });
  });

  it('SH-7: the database refuses a request decided by the person who raised it', async () => {
    await expect(
      asOwner(
        'self-approve',
        sql`
        INSERT INTO shift_request (organization_id, user_id, kind, from_date, to_date, reason, requested_by, status, decided_by)
        VALUES (${ORG}, ${EMP}, 'flexible', '2026-10-20', '2026-10-20', 'Doctor', ${HR}, 'approved', ${HR})`,
      ),
    ).rejects.toThrow(/shift_request_check/);
  });

  it('two assignments of one kind cannot cover the same date (exclusion constraint)', async () => {
    await expect(
      asOwner(
        'overlapping template',
        sql`
        INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
        VALUES (${ORG}, ${EMP}, 'template', ${night}, '2026-11-01', ${HR})`,
      ),
    ).rejects.toThrow(/exclusion|conflicting key/);
  });
});
