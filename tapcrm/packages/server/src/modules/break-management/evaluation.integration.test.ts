import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock } from '../../platform/time.js';
import { lockPerson } from '../attendance/facade.js';
import { evaluateBreakDay } from './evaluator.js';

/**
 * Break evaluation against PostgreSQL: what a breach does to the day, to pay
 * and to the employee's notifications — and what happens when the day is
 * corrected and the breach no longer stands.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run \
 *     packages/server/src/modules/break-management/evaluation.integration.test.ts
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const CLOCK = fixedClock(new Date('2026-09-28T12:00:00Z'));

const asOwner = <T = Record<string, unknown>>(reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query<T>('migration', reason, fragment);

function system() {
  return createJobContext({ organizationId: ORG, principal: systemPrincipal(ORG), jobName: 'test', runId: randomUUID() });
}

const ist = (date: string, time: string) => `${date}T${time}:00+05:30`;

async function person(label: string): Promise<string> {
  const id = randomUUID();
  await asOwner('user', sql`
    INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
    VALUES (${id}, ${ORG}, 'employee', ${`EV-${label}-${id.slice(0, 4)}`.toUpperCase()}, ${`${label}-${id.slice(0, 8)}@ev.test`},
            ${`Person ${label}`}, ${POS}, ${DEPT})
  `);
  return id;
}

/** A policy with one rule over a 60-minute total break, assigned to one person. */
async function policyFor(userId: string, consequence: string, options: { amount?: string; autoApply?: boolean } = {}) {
  const policyId = randomUUID();
  const versionId = randomUUID();
  const ruleId = randomUUID();
  await asOwner('policy', sql`INSERT INTO break_policy (id, organization_id, name) VALUES (${policyId}, ${ORG}, ${`P ${consequence}`})`);
  await asOwner('version', sql`
    INSERT INTO break_policy_version
      (id, organization_id, policy_id, effective_from, upper_total_minutes, upper_single_minutes,
       lower_total_minutes, lower_enforced, grace_minutes, warning_percent, counts_toward_work_hours)
    VALUES (${versionId}, ${ORG}, ${policyId}, '2026-01-01', 60, null, null, false, 5, 80, true)
  `);
  // An automatic rule carries an HR attestation (who vouched for it, for which month).
  const attester = options.autoApply ? await person('attester') : null;
  await asOwner('rule', sql`
    INSERT INTO break_penalty_rule
      (id, organization_id, policy_version_id, ordinal, condition, occurrence_window, occurrence_count,
       consequence, minutes, amount, auto_apply, attested_by, attested_month, attested_at)
    VALUES (${ruleId}, ${ORG}, ${versionId}, 1, 'over-total', 'day', 1,
            ${consequence}, null, ${options.amount ?? null}, ${options.autoApply ?? false},
            ${attester}, ${attester ? '2026-09-01' : null}::date, ${attester ? new Date('2026-09-01T00:00:00Z') : null})
  `);
  await asOwner('assignment', sql`
    INSERT INTO break_policy_assignment (id, organization_id, policy_id, priority, effective_from, user_id)
    VALUES (${randomUUID()}, ${ORG}, ${policyId}, 0, '2026-01-01', ${userId})
  `);
  return { ruleId };
}

/** A closed day with a 90-minute lunch break: 09:00 in, 12:00–13:30 break, 18:00 out. */
async function dayWithLongBreak(userId: string, date: string) {
  const recordId = randomUUID();
  await asOwner('record', sql`
    INSERT INTO attendance_record (
      id, organization_id, user_id, work_date, state, window_start, window_end, shift_source,
      shift_snapshot, placement_snapshot, input_version, calculated_input_version, calculation_version,
      close_due_at, day_type, breaks_evaluation_revision
    ) VALUES (
      ${recordId}, ${ORG}, ${userId}, ${date}, 'closed', ${ist(date, '00:00')}, ${ist(date, '23:59')}, 'default',
      '{"shiftId": null}'::jsonb, ${JSON.stringify({ departmentId: DEPT, positionId: POS, teamId: null })}::jsonb,
      1, 1, 1, ${ist(date, '23:00')}, 'working', 0
    )
  `);
  const events: Record<string, string> = {};
  for (const [kind, time] of [['in', '09:00'], ['break-start', '12:00'], ['break-end', '13:30'], ['out', '18:00']] as const) {
    events[kind] = await event(userId, recordId, kind, ist(date, time));
  }
  return { recordId, events };
}

async function event(userId: string, recordId: string, kind: string, at: string, supersedes: string | null = null): Promise<string> {
  const id = randomUUID();
  await asOwner('event', sql`
    INSERT INTO attendance_event (id, organization_id, user_id, kind, occurred_at, source, evidence, supersedes_event_id)
    VALUES (${id}, ${ORG}, ${userId}, ${kind}, ${at}::timestamptz, ${supersedes ? 'system' : 'web'}, 'confirmed', ${supersedes})
  `);
  await asOwner('assignment', sql`
    INSERT INTO attendance_event_assignment (organization_id, user_id, event_id, attendance_record_id, reason, pinned)
    VALUES (${ORG}, ${userId}, ${id}, ${recordId}, 'midpoint', false)
  `);
  return id;
}

/** The day was recalculated (a new calculation version), so it is evaluated again. */
async function recalculated(recordId: string, version: number): Promise<void> {
  await asOwner('recalc', sql`UPDATE attendance_record SET calculation_version = ${version} WHERE id = ${recordId}`);
}

async function evaluate(userId: string, recordId: string, version: number) {
  return db.transaction(system(), async (tx) => {
    await lockPerson(tx, userId);
    return evaluateBreakDay(tx, recordId, version, 0n, CLOCK);
  });
}

async function notificationsFor(userId: string, type: string) {
  return asOwner<{ payload: { title: string; body: string; audience: { users?: string[] } } }>('outbox', sql`
    SELECT payload FROM notification_outbox
    WHERE organization_id = ${ORG} AND payload->>'type' = ${type}
      AND payload->'audience'->'users' ? ${userId}
  `);
}

describe.skipIf(!enabled)('break evaluation consequences (PostgreSQL)', () => {
  beforeAll(async () => {
    // Payroll registers the deduction writer that an amount rule uses (app boot does this).
    const { registerPayrollPorts } = await import('../payroll/facade.js');
    registerPayrollPorts();
    await asOwner('org', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`EV${ORG.slice(0, 6)}`}, 'Break Evaluation Test', 'Asia/Kolkata')
    `);
    await asOwner('dept', sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Ops', 'operations')`);
    await asOwner('position', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'EMP', 'Employee', 20)
    `);
  });

  afterAll(async () => {
    await closePools();
  });

  it('asks the employee to explain once, even when the day is evaluated again', async () => {
    const userId = await person('explain');
    const { ruleId } = await policyFor(userId, 'require-explanation');
    const { recordId, events } = await dayWithLongBreak(userId, '2026-09-14');

    expect(await evaluate(userId, recordId, 1)).toBe('evaluated');
    const [breach] = await asOwner<{ status: string; matchedRuleId: string }>('breach', sql`
      SELECT status, matched_rule_id FROM break_breach WHERE attendance_record_id = ${recordId} AND status <> 'superseded'
    `);
    expect(breach).toMatchObject({ status: 'pending', matchedRuleId: ruleId });
    const first = await notificationsFor(userId, 'breaks.explanation_required');
    expect(first).toHaveLength(1);
    expect(first[0]!.payload.title).toBe('Please explain your break on 14 Sep 2026');

    // A corrected departure changes the evidence but not the outcome: a new answer, no new message.
    await event(userId, recordId, 'out', ist('2026-09-14', '18:05'), events['out']);
    await recalculated(recordId, 2);
    expect(await evaluate(userId, recordId, 2)).toBe('evaluated');
    const answers = await asOwner<{ status: string }>('answers', sql`
      SELECT status FROM break_breach WHERE attendance_record_id = ${recordId} ORDER BY created_at
    `);
    expect(answers.map((a) => a.status)).toEqual(['superseded', 'pending']);
    expect(await notificationsFor(userId, 'breaks.explanation_required')).toHaveLength(1);
  });

  it('an automatic amount rule deducts pay, and a corrected day takes the deduction back', async () => {
    const userId = await person('amount');
    await policyFor(userId, 'deduct-amount', { amount: '250.00', autoApply: true });
    const { recordId, events } = await dayWithLongBreak(userId, '2026-09-15');

    expect(await evaluate(userId, recordId, 1)).toBe('evaluated');
    const [breach] = await asOwner<{ id: string; status: string; autoApplied: boolean }>('breach', sql`
      SELECT id, status, auto_applied FROM break_breach WHERE attendance_record_id = ${recordId}
    `);
    expect(breach).toMatchObject({ status: 'confirmed', autoApplied: true });
    const deductions = () => asOwner<{ amount: string; periodStart: string; revokedAt: Date | null }>('deduction', sql`
      SELECT amount::text AS amount, period_start::text AS period_start, revoked_at
      FROM payroll_input WHERE break_breach_id = ${breach!.id}
    `);
    // Before this fix an automatic amount rule confirmed the breach and never reached payroll.
    const written = await deductions();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ periodStart: '2026-09-01', revokedAt: null });
    expect(Number(written[0]!.amount)).toBe(250);
    const told = await notificationsFor(userId, 'breaks.breach_applied');
    expect(told).toHaveLength(1);
    expect(told[0]!.payload.body).toContain('₹250 is deducted from pay');

    // The break end is corrected to 12:30: a 30-minute break, a clean day.
    await event(userId, recordId, 'break-end', ist('2026-09-15', '12:30'), events['break-end']);
    await recalculated(recordId, 2);
    expect(await evaluate(userId, recordId, 2)).toBe('evaluated');
    const [after] = await asOwner<{ status: string }>('after', sql`SELECT status FROM break_breach WHERE id = ${breach!.id}`);
    expect(after!.status).toBe('superseded');
    const [deduction] = await deductions();
    expect(deduction!.revokedAt).not.toBeNull();
  });

  it('an automatic attendance rule marks the day, and a corrected day removes the mark', async () => {
    const userId = await person('late');
    await policyFor(userId, 'mark-late', { autoApply: true });
    const { recordId, events } = await dayWithLongBreak(userId, '2026-09-16');

    expect(await evaluate(userId, recordId, 1)).toBe('evaluated');
    const [breach] = await asOwner<{ id: string }>('breach', sql`SELECT id FROM break_breach WHERE attendance_record_id = ${recordId}`);
    const overlays = () => asOwner('overlays', sql`SELECT id FROM attendance_overlay WHERE break_breach_id = ${breach!.id}`);
    expect(await overlays()).toHaveLength(1);

    await event(userId, recordId, 'break-end', ist('2026-09-16', '12:30'), events['break-end']);
    await recalculated(recordId, 2);
    expect(await evaluate(userId, recordId, 2)).toBe('evaluated');
    // Before this fix the superseded breach's "late" mark stayed on the corrected day.
    expect(await overlays()).toHaveLength(0);
  });
});
