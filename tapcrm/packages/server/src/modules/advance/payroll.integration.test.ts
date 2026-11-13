/**
 * Advance recoveries and penalties reach the payslip (migration 0142).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { createTestContext } from '../../platform/test-helpers.js';
import { chargePenalty, registerPenaltyPayrollPorts, releasePenalty } from '../penalties/facade.js';
import { planDefaultRecovery, registerAdvancePayrollPorts, scheduleRecovery } from './payroll.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const seed = <T>(reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query<T>('seed', reason, fragment);

async function setup() {
  const orgId = (await seed<{ id: string }>('org', sql`
    INSERT INTO organization (code, name)
    VALUES ('AP' || replace(gen_random_uuid()::text, '-', ''), 'Advance payroll test') RETURNING id`))[0]!.id;
  const departmentId = (await seed<{ id: string }>('department', sql`
    INSERT INTO department (organization_id, code, name, kind)
    VALUES (${orgId}, 'OPS', 'Operations', 'support') RETURNING id`))[0]!.id;
  const positionId = (await seed<{ id: string }>('position', sql`
    INSERT INTO position (organization_id, department_id, code, name, organizational_level)
    VALUES (${orgId}, ${departmentId}, 'STAFF', 'Staff', 10) RETURNING id`))[0]!.id;
  const [hr, emp] = await Promise.all(['HR', 'EMP'].map(async (code) => (await seed<{ id: string }>(`user ${code}`, sql`
    INSERT INTO app_user (organization_id, employee_id, email, full_name, account_type, department_id, position_id)
    VALUES (${orgId}, ${code}, ${`${code.toLowerCase()}-${randomUUID()}@test.invalid`}, ${code}, 'employee',
            ${departmentId}, ${positionId})
    RETURNING id`))[0]!.id));
  const advanceId = (await seed<{ id: string }>('advance', sql`
    INSERT INTO employee_advance (organization_id, employee_id, requested_amount_paise, approved_amount_paise,
      currency, requested_for_period, reason, status, source, approved_at, approved_by, created_by)
    VALUES (${orgId}, ${emp}, 1000000, 1000000, 'INR', '2026-10-01', 'Medical bills', 'approved', 'manual',
      now(), ${hr}, ${hr}) RETURNING id`))[0]!.id;
  return { orgId, hr: hr!, emp: emp!, advanceId, ctx: createTestContext(orgId, hr!) };
}

const inputs = (orgId: string) => seed<{ kind: string; amount: string; periodStart: string; revoked: boolean; advanceDeductionId: string | null; penaltyId: string | null }>('read inputs', sql`
  SELECT kind, amount::text AS amount, period_start::text AS period_start, revoked_at IS NOT NULL AS revoked,
         advance_deduction_id, penalty_id
  FROM payroll_input WHERE organization_id = ${orgId} ORDER BY created_at, id`);
const deductions = (orgId: string) => seed<{ id: string; payrollPeriod: string; scheduledAmountPaise: string; status: string; plannedBy: string }>('read deductions', sql`
  SELECT id, payroll_period::text AS payroll_period, scheduled_amount_paise::text AS scheduled_amount_paise, status, planned_by
  FROM employee_advance_deduction WHERE organization_id = ${orgId} ORDER BY payroll_period`);

describe.skipIf(!enabled)('advances and penalties in payroll (PostgreSQL)', () => {
  afterAll(closePools);
  registerAdvancePayrollPorts();
  registerPenaltyPayrollPorts();

  it('an approved advance is recovered from its month; an HR schedule replaces that plan', async () => {
    const { orgId, emp, advanceId, ctx } = await setup();
    const advance = { id: advanceId, employeeId: emp, approvedAmountPaise: '1000000', requestedForPeriod: '2026-10-01' };
    await db.transaction(ctx, (tx) => planDefaultRecovery(tx, ctx, advance));
    expect(await deductions(orgId)).toMatchObject([
      { payrollPeriod: '2026-10-01', scheduledAmountPaise: '1000000', status: 'pending', plannedBy: 'approval' },
    ]);
    expect(await inputs(orgId)).toMatchObject([
      { kind: 'advance-recovery', amount: '10000.0000', periodStart: '2026-10-01', revoked: false },
    ]);

    // HR spreads it: 2,500 in October (takes over the default row) and 2,500 in November.
    await db.transaction(ctx, (tx) => scheduleRecovery(tx, ctx, advance, '2026-10-01', '250000'));
    await db.transaction(ctx, (tx) => scheduleRecovery(tx, ctx, advance, '2026-11-01', '250000'));
    expect(await deductions(orgId)).toMatchObject([
      { payrollPeriod: '2026-10-01', scheduledAmountPaise: '250000', status: 'pending', plannedBy: 'hr' },
      { payrollPeriod: '2026-11-01', scheduledAmountPaise: '250000', status: 'pending', plannedBy: 'hr' },
    ]);
    const live = (await inputs(orgId)).filter((row) => !row.revoked);
    expect(live.map((row) => [row.periodStart, row.amount])).toEqual([
      ['2026-10-01', '2500.0000'],
      ['2026-11-01', '2500.0000'],
    ]);
    await expect(db.transaction(ctx, (tx) => scheduleRecovery(tx, ctx, advance, '2026-11-01', '100000')))
      .rejects.toThrow(/already scheduled/);
    await expect(db.transaction(ctx, (tx) => scheduleRecovery(tx, ctx, advance, '2026-12-01', '600000')))
      .rejects.toThrow(/cannot exceed the approved balance/);
  });

  it('a penalty is deducted in its month and withdrawn when cancelled', async () => {
    const { orgId, hr, emp, ctx } = await setup();
    const penaltyIds = await Promise.all([1, 2].map(async (n) => (await seed<{ id: string }>('penalty', sql`
      INSERT INTO employee_penalty (organization_id, employee_id, penalty_type, amount_paise, penalty_date,
        payroll_period, remarks, created_by)
      VALUES (${orgId}, ${emp}, 'late_arrival', ${n * 50000}, '2026-10-15', '2026-10-01', 'Late again', ${hr})
      RETURNING id`))[0]!.id));
    for (const [n, id] of penaltyIds.entries())
      await db.transaction(ctx, (tx) => chargePenalty(tx, {
        id, employeeId: emp, payrollPeriod: '2026-10-01', amountPaise: String((n + 1) * 50000),
        penaltyType: 'late_arrival', remarks: 'Late again',
      }, hr));
    await db.transaction(ctx, (tx) => releasePenalty(tx, penaltyIds[1]!, hr, 'Raised by mistake'));
    expect((await inputs(orgId)).map((row) => [row.kind, row.amount, row.revoked])).toEqual([
      ['penalty', '500.0000', false],
      ['penalty', '1000.0000', true],
    ]);
  });
});
