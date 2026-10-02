import type { Tx } from '../packages/server/src/platform/dal/db.js';
import { sql } from '../packages/server/src/platform/dal/sql.js';
import { recalculateRecord } from '../packages/server/src/modules/attendance/recalculate.js';
import { employeesInPeriod, fingerprint, freezeEmployees } from '../packages/server/src/modules/payroll/freeze.js';
import type { PayrollConfigRow } from '../packages/server/src/modules/payroll/config.js';
import { DEMO_ACTIVITY_MARKER, DEMO_EMPLOYEES, demoDates } from './demo-fixture.js';

type Person = { id: string; departmentId: string; positionId: string; teamId: string | null };
type DemoCounts = { shifts: number; attendanceDays: number; punches: number; leaveRequests: number; salaries: number; payrollInputs: number; payrollRuns: number };

const marker = DEMO_ACTIVITY_MARKER;
const demoPayrollApproval = `${marker}:sample settings, not statutory approval`;

export async function seedDemoActivity(tx: Tx, organization: { id: string; timezone: string }, users: Map<string, string>): Promise<DemoCounts> {
  const counts: DemoCounts = { shifts: 0, attendanceDays: 0, punches: 0, leaveRequests: 0, salaries: 0, payrollInputs: 0, payrollRuns: 0 };
  const admin = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user WHERE organization_id = ${organization.id} AND account_type = 'super-admin' AND status = 'active' ORDER BY created_at LIMIT 1
  `);
  if (!admin) throw new Error('Demo activity requires an active Super Admin');
  const today = await tx.one<{ today: string }>(sql`SELECT (now() AT TIME ZONE ${organization.timezone})::date::text AS today`);
  const dates = demoDates(today.today);
  const firstDay = dates.workdays[0]!;

  const existingShift = await tx.maybeOne<{ id: string }>(sql`SELECT id FROM shift WHERE organization_id = ${organization.id} AND code = 'DEMO-DAY'`);
  const shift = existingShift ?? await tx.one<{ id: string }>(sql`
    INSERT INTO shift (organization_id, code, name, kind, created_by)
    VALUES (${organization.id}, 'DEMO-DAY', 'Demo day · 09:30–18:00', 'fixed', ${admin.id}) RETURNING id
  `);
  const existingVersion = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM shift_version WHERE organization_id = ${organization.id} AND shift_id = ${shift.id} AND effective_from = ${firstDay}::date
  `);
  const version = existingVersion ?? await tx.one<{ id: string }>(sql`
    INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
      early_exit_grace_minutes, full_day_minutes, half_day_minutes, min_overtime_minutes,
      early_window_minutes, max_closing_extension_minutes, created_by)
    VALUES (${organization.id}, ${shift.id}, ${firstDay}::date, '09:30', '18:00', 10, 5, 450, 240, 30, 180, 240, ${admin.id}) RETURNING id
  `);
  if (!existingShift) counts.shifts += 1;

  const leaveType = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM leave_type WHERE organization_id = ${organization.id} AND code = 'DEMO-ANNUAL'
  `) ?? await tx.one<{ id: string }>(sql`
    INSERT INTO leave_type (organization_id, code, name, kind, accrual_days, enforcement, paid_leave, created_by)
    VALUES (${organization.id}, 'DEMO-ANNUAL', 'Demo annual leave', 'absence', 12, true, true, ${admin.id}) RETURNING id
  `);

  for (const [index, employee] of DEMO_EMPLOYEES.entries()) {
    const userId = users.get(employee.key);
    if (!userId) throw new Error(`Missing demo employee ${employee.key}`);
    const person = await tx.one<Person>(sql`
      SELECT id, department_id, position_id, team_id FROM app_user WHERE organization_id = ${organization.id} AND id = ${userId}
    `);
    await tx.query(sql`UPDATE app_user SET joined_on = COALESCE(joined_on, ${dates.joinedOn}::date) WHERE organization_id = ${organization.id} AND id = ${userId}`);
    const otherAssignment = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM shift_assignment WHERE organization_id = ${organization.id} AND user_id = ${userId}
        AND kind = 'template' AND daterange(effective_from, effective_to, '[)') && daterange(${firstDay}::date, 'infinity'::date, '[)')
        AND (reason IS NULL OR reason <> ${marker}) LIMIT 1
    `);
    if (otherAssignment) throw new Error(`Demo seed refused: ${employee.email} already has a non-demo shift assignment`);
    const assignment = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM shift_assignment WHERE organization_id = ${organization.id} AND user_id = ${userId} AND reason = ${marker}
    `);
    if (!assignment) await tx.query(sql`
      INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, reason, created_by)
      VALUES (${organization.id}, ${userId}, 'template', ${shift.id}, ${firstDay}::date, ${marker}, ${admin.id})
    `);

    const opening = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM leave_balance_entry WHERE organization_id = ${organization.id} AND user_id = ${userId}
        AND leave_type_id = ${leaveType.id} AND kind = 'opening' AND period_year = ${Number(today.today.slice(0, 4))}
    `);
    if (!opening) await tx.query(sql`
      INSERT INTO leave_balance_entry (organization_id, user_id, leave_type_id, kind, units, period_year)
      VALUES (${organization.id}, ${userId}, ${leaveType.id}, 'opening', 12, ${Number(today.today.slice(0, 4))})
    `);

    const approvedLeaveDay = index % 5 === 0 ? dates.workdays[2]! : null;
    if (approvedLeaveDay) {
      const reason = `${marker}:approved:${employee.key}`;
      let request = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM leave_request WHERE organization_id = ${organization.id} AND user_id = ${userId} AND reason = ${reason}
      `);
      if (!request) {
        request = await tx.one<{ id: string }>(sql`
          INSERT INTO leave_request (organization_id, user_id, leave_type_id, kind, from_date, to_date, days_consumed,
            reason, status, requested_by, decided_by, decided_at, decision_note)
          VALUES (${organization.id}, ${userId}, ${leaveType.id}, 'absence', ${approvedLeaveDay}::date, ${approvedLeaveDay}::date,
            1, ${reason}, 'approved', ${userId}, ${admin.id}, now(), 'Demo approval') RETURNING id
        `);
        counts.leaveRequests += 1;
      }
      await tx.query(sql`
        INSERT INTO leave_balance_entry (organization_id, user_id, leave_type_id, kind, units, leave_request_id, period_year)
        VALUES (${organization.id}, ${userId}, ${leaveType.id}, 'consumption', 1, ${request.id}, ${Number(approvedLeaveDay.slice(0, 4))})
        ON CONFLICT DO NOTHING
      `);
      await tx.query(sql`
        INSERT INTO attendance_overlay (organization_id, user_id, work_date, kind, paid, leave_request_id)
        VALUES (${organization.id}, ${userId}, ${approvedLeaveDay}::date, 'leave-full', true, ${request.id})
        ON CONFLICT DO NOTHING
      `);
    }
    if (index % 4 === 1) {
      const reason = `${marker}:pending:${employee.key}`;
      const pending = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM leave_request WHERE organization_id = ${organization.id} AND user_id = ${userId} AND reason = ${reason}
      `);
      if (!pending) {
        await tx.query(sql`
          INSERT INTO leave_request (organization_id, user_id, leave_type_id, kind, from_date, to_date, days_consumed,
            reason, status, requested_by)
          VALUES (${organization.id}, ${userId}, ${leaveType.id}, 'absence', ${dates.futureLeave}::date,
            ${dates.futureLeave}::date, 1, ${reason}, 'pending', ${userId})
        `);
        counts.leaveRequests += 1;
      }
    }

    for (const [dayIndex, day] of dates.workdays.entries()) {
      const present = day !== approvedLeaveDay && !(index % 7 === 3 && dayIndex === 5);
      const existing = await tx.maybeOne<{ id: string; provenance: { demoFixture?: string } }>(sql`
        SELECT id, provenance FROM attendance_record WHERE organization_id = ${organization.id} AND user_id = ${userId} AND work_date = ${day}::date
      `);
      if (existing && existing.provenance.demoFixture !== marker) throw new Error(`Demo seed refused: ${employee.email} has real attendance on ${day}`);
      if (existing) continue;
      const snapshot = {
        date: day, source: 'template', shiftId: shift.id, versionId: version.id, kind: 'fixed', start: '09:30', end: '18:00',
        isOvernight: false, graceMinutes: 10, earlyExitGraceMinutes: 5, fullDayMinutes: 450, halfDayMinutes: 240,
        complementaryHalfMinutes: null, minOvertimeMinutes: 30, earlyWindowMinutes: 180,
        maxClosingExtensionMinutes: 240, timezone: organization.timezone,
      };
      const record = await tx.one<{ id: string }>(sql`
        INSERT INTO attendance_record (organization_id, user_id, work_date, window_start, window_end, close_due_at,
          state, closed_at, closed_by, shift_snapshot, shift_source, placement_snapshot, day_type, provenance)
        VALUES (${organization.id}, ${userId}, ${day}::date,
          ((${day}::date + time '05:00') AT TIME ZONE ${organization.timezone}),
          ((${day}::date + time '23:00') AT TIME ZONE ${organization.timezone}),
          ((${day}::date + time '23:00') AT TIME ZONE ${organization.timezone}),
          'closed', now(), ${present ? 'punch-out' : 'no-show'}, ${JSON.stringify(snapshot)}::jsonb, 'template',
          ${JSON.stringify({ departmentId: person.departmentId, positionId: person.positionId, teamId: person.teamId })}::jsonb,
          'working', ${JSON.stringify({ demoFixture: marker })}::jsonb) RETURNING id
      `);
      counts.attendanceDays += 1;
      if (present) {
        const late = index % 4 === 2 && dayIndex === 4;
        const short = index % 6 === 4 && dayIndex === 6;
        const punches: [string, string][] = [
          ['in', late ? '10:05' : '09:30'],
          ...(dayIndex === 3 ? [['break-start', '13:00'], ['break-end', '13:30']] as [string, string][] : []),
          ['out', short ? '14:00' : '18:05'],
        ];
        for (const [kind, time] of punches) {
          const event = await tx.one<{ id: string }>(sql`
            INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, client_event_id)
            VALUES (${organization.id}, ${userId}, ${kind}, ((${day}::date + ${time}::time) AT TIME ZONE ${organization.timezone}),
              'import', 'confirmed', ${`${marker}:${employee.key}:${day}:${kind}`}) RETURNING id
          `);
          await tx.query(sql`
            INSERT INTO attendance_event_assignment (organization_id, user_id, event_id, attendance_record_id, reason, pinned)
            VALUES (${organization.id}, ${userId}, ${event.id}, ${record.id}, 'import', false)
          `);
          counts.punches += 1;
        }
      }
      await recalculateRecord(tx, record.id);
      await tx.query(sql`
        UPDATE attendance_record SET provenance = provenance || ${JSON.stringify({ demoFixture: marker })}::jsonb
        WHERE organization_id = ${organization.id} AND id = ${record.id}
      `);
    }

    const salary = await tx.maybeOne<{ id: string }>(sql`
      SELECT s.id FROM salary_structure s JOIN salary_structure_line l ON l.organization_id = s.organization_id AND l.structure_id = s.id
      WHERE s.organization_id = ${organization.id} AND s.user_id = ${userId} AND l.code = 'DEMO-BASE' LIMIT 1
    `);
    if (!salary) {
      const otherSalary = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM salary_structure WHERE organization_id = ${organization.id} AND user_id = ${userId} LIMIT 1
      `);
      if (otherSalary) throw new Error(`Demo seed refused: ${employee.email} already has a non-demo salary structure`);
      const structure = await tx.one<{ id: string }>(sql`
        INSERT INTO salary_structure (organization_id, user_id, currency, effective_from, created_by)
        VALUES (${organization.id}, ${userId}, 'INR', ${dates.joinedOn}::date, ${admin.id}) RETURNING id
      `);
      const base = 30000 + Math.max(0, 9 - index) * 5000;
      await tx.query(sql`
        INSERT INTO salary_structure_line (organization_id, structure_id, code, label, kind, amount, prorated, sort_order)
        VALUES (${organization.id}, ${structure.id}, 'DEMO-BASE', 'Base salary', 'earning', ${base}, true, 1),
               (${organization.id}, ${structure.id}, 'DEMO-ALLOWANCE', 'Travel allowance', 'earning', ${Math.round(base * .12)}, true, 2)
      `);
      counts.salaries += 1;
    }
    if (index % 3 === 0) {
      const reason = `${marker}:bonus:${employee.key}`;
      const input = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM payroll_input WHERE organization_id = ${organization.id} AND user_id = ${userId}
          AND period_start = ${dates.monthStart}::date AND reason = ${reason}
      `);
      if (!input) {
        await tx.query(sql`
          INSERT INTO payroll_input (organization_id, user_id, period_start, kind, amount, label, reason, created_by)
          VALUES (${organization.id}, ${userId}, ${dates.monthStart}::date, 'bonus', ${1500 + index * 100},
            'Demo performance bonus', ${reason}, ${admin.id})
        `);
        counts.payrollInputs += 1;
      }
    }
  }
  // A frozen draft makes the Runs page useful without publishing fictitious payslips.
  // Never install sample payroll settings over a real employee population or accepted config.
  const otherEmployees = await tx.one<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM app_user WHERE organization_id = ${organization.id} AND account_type = 'employee'
      AND id <> ALL(${[...users.values()]}::uuid[])
  `);
  const activeConfig = await tx.maybeOne<{ id: string; caHrApproval: string }>(sql`
    SELECT id, ca_hr_approval FROM payroll_config WHERE organization_id = ${organization.id}
      AND status = 'active' AND effective_from <= ${dates.monthStart}::date
    ORDER BY effective_from DESC LIMIT 1
  `);
  if (otherEmployees.count === 0 && (!activeConfig || activeConfig.caHrApproval === demoPayrollApproval)) {
    const configId = activeConfig?.id ?? (await tx.one<{ id: string }>(sql`
      INSERT INTO payroll_config (organization_id, effective_from, settings, accepted_by, ca_hr_approval)
      VALUES (${organization.id}, ${dates.monthStart}::date,
        ${JSON.stringify({ currency: 'INR', notes: 'Demo fixture only' })}::jsonb, ${admin.id}, ${demoPayrollApproval}) RETURNING id
    `)).id;
    const existingRun = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM payroll_run WHERE organization_id = ${organization.id} AND period_start = ${dates.monthStart}::date
        AND status NOT IN ('failed', 'cancelled') LIMIT 1
    `);
    if (!existingRun) {
      const year = Number(dates.monthStart.slice(0, 4));
      const month = Number(dates.monthStart.slice(5, 7));
      const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      const config = await tx.one<PayrollConfigRow>(sql`
        SELECT id, organization_id AS "organizationId", effective_from::text AS "effectiveFrom", settings,
          schema_version AS "schemaVersion", accepted_by AS "acceptedBy", accepted_at::text AS "acceptedAt",
          ca_hr_approval AS "caHrApproval", status, supersedes_config_id AS "supersedesConfigId",
          created_at::text AS "createdAt"
        FROM payroll_config WHERE organization_id = ${organization.id} AND id = ${configId}
      `);
      const employees = await employeesInPeriod(tx, organization.id, dates.monthStart, periodEnd, [...users.values()]);
      const frozen = await freezeEmployees(tx, organization.id, { start: dates.monthStart, end: periodEnd }, config, employees);
      const run = await tx.one<{ id: string }>(sql`
        INSERT INTO payroll_run (organization_id, period_start, period_end, config_id, created_by,
          config_fingerprint, population_fingerprint)
        VALUES (${organization.id}, ${dates.monthStart}::date, ${periodEnd}::date, ${configId}, ${admin.id},
          ${fingerprint({ configId, settings: config.settings })}, ${fingerprint(employees.map((person) => person.userId).sort())})
        RETURNING id
      `);
      for (const employee of frozen) await tx.query(sql`
        INSERT INTO payroll_run_employee (organization_id, run_id, user_id, employment_window_start,
          employment_window_end, inputs, inputs_fingerprint)
        VALUES (${organization.id}, ${run.id}, ${employee.userId}, ${employee.employmentFrom}::date,
          ${employee.employmentTo}::date, ${JSON.stringify(employee.inputs)}::jsonb, ${employee.fingerprint})
      `);
      counts.payrollRuns += 1;
    }
  }
  return counts;
}

/** Delete only tagged fixture activity. Referencing product data makes the transaction fail safely. */
export async function cleanupDemoActivity(tx: Tx, organizationId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const ids = userIds;
  const configs = await tx.query<{ id: string }>(sql`
    SELECT id FROM payroll_config WHERE organization_id = ${organizationId} AND ca_hr_approval = ${demoPayrollApproval}
  `);
  const configIds = configs.map((row) => row.id);
  if (configIds.length > 0) {
    const runs = await tx.query<{ id: string }>(sql`
      SELECT id FROM payroll_run WHERE organization_id = ${organizationId} AND config_id = ANY(${configIds}::uuid[])
    `);
    const runIds = runs.map((row) => row.id);
    if (runIds.length > 0) {
      const published = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM payslip WHERE organization_id = ${organizationId} AND run_id = ANY(${runIds}::uuid[])
          AND (status = 'published' OR immutable) LIMIT 1
      `);
      if (published) throw new Error('Cleanup refused: a demo payroll run has published payslips');
      const posted = await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM ledger_posting_intent WHERE organization_id = ${organizationId}
          AND run_id = ANY(${runIds}::uuid[]) AND consumed_at IS NOT NULL LIMIT 1
      `);
      if (posted) throw new Error('Cleanup refused: a demo payroll run has posted ledger entries');
      const slips = await tx.query<{ id: string }>(sql`
        SELECT id FROM payslip WHERE organization_id = ${organizationId} AND run_id = ANY(${runIds}::uuid[])
      `);
      const slipIds = slips.map((row) => row.id);
      if (slipIds.length > 0) {
        await tx.query(sql`DELETE FROM payslip_line WHERE organization_id = ${organizationId} AND payslip_id = ANY(${slipIds}::uuid[])`);
        await tx.query(sql`DELETE FROM payslip_salary_use WHERE organization_id = ${organizationId} AND payslip_id = ANY(${slipIds}::uuid[])`);
        await tx.query(sql`DELETE FROM payslip_document WHERE organization_id = ${organizationId} AND payslip_id = ANY(${slipIds}::uuid[])`);
        await tx.query(sql`DELETE FROM payslip_flag WHERE organization_id = ${organizationId} AND payslip_id = ANY(${slipIds}::uuid[])`);
      }
      await tx.query(sql`DELETE FROM payroll_run_drift WHERE organization_id = ${organizationId} AND run_id = ANY(${runIds}::uuid[])`);
      await tx.query(sql`DELETE FROM ledger_posting_intent WHERE organization_id = ${organizationId} AND run_id = ANY(${runIds}::uuid[])`);
      await tx.query(sql`DELETE FROM payslip WHERE organization_id = ${organizationId} AND run_id = ANY(${runIds}::uuid[])`);
      await tx.query(sql`DELETE FROM payroll_run_employee WHERE organization_id = ${organizationId} AND run_id = ANY(${runIds}::uuid[])`);
      await tx.query(sql`DELETE FROM payroll_run WHERE organization_id = ${organizationId} AND id = ANY(${runIds}::uuid[])`);
    }
    await tx.query(sql`DELETE FROM payroll_config_source WHERE organization_id = ${organizationId} AND config_id = ANY(${configIds}::uuid[])`);
    await tx.query(sql`DELETE FROM payroll_config WHERE organization_id = ${organizationId} AND id = ANY(${configIds}::uuid[])`);
  }
  const demoStructures = await tx.query<{ id: string }>(sql`
    SELECT DISTINCT s.id FROM salary_structure s JOIN salary_structure_line l
      ON l.organization_id = s.organization_id AND l.structure_id = s.id
    WHERE s.organization_id = ${organizationId} AND s.user_id = ANY(${ids}::uuid[]) AND l.code = 'DEMO-BASE'
  `);
  const structureIds = demoStructures.map((row) => row.id);
  if (structureIds.length > 0) {
    const extraLine = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM salary_structure_line WHERE organization_id = ${organizationId}
        AND structure_id = ANY(${structureIds}::uuid[]) AND code NOT IN ('DEMO-BASE', 'DEMO-ALLOWANCE') LIMIT 1
    `);
    if (extraLine) throw new Error('Cleanup refused: a demo salary structure has non-demo lines');
  }
  await tx.query(sql`DELETE FROM payroll_input WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[]) AND reason LIKE ${marker + ':%'}`);
  if (structureIds.length > 0) {
    await tx.query(sql`DELETE FROM salary_structure_line WHERE organization_id = ${organizationId} AND structure_id = ANY(${structureIds}::uuid[])`);
    await tx.query(sql`DELETE FROM salary_structure WHERE organization_id = ${organizationId} AND id = ANY(${structureIds}::uuid[])`);
  }
  await tx.query(sql`DELETE FROM attendance_overlay WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[])
    AND leave_request_id IN (SELECT id FROM leave_request WHERE organization_id = ${organizationId} AND reason LIKE ${marker + ':%'})`);
  await tx.query(sql`DELETE FROM leave_balance_entry WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[])
    AND leave_type_id IN (SELECT id FROM leave_type WHERE organization_id = ${organizationId} AND code = 'DEMO-ANNUAL')`);
  await tx.query(sql`DELETE FROM leave_request WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[]) AND reason LIKE ${marker + ':%'}`);
  await tx.query(sql`DELETE FROM attendance_event_assignment WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[])
    AND event_id IN (SELECT id FROM attendance_event WHERE organization_id = ${organizationId} AND client_event_id LIKE ${marker + ':%'})`);
  await tx.query(sql`DELETE FROM attendance_event WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[]) AND client_event_id LIKE ${marker + ':%'}`);
  await tx.query(sql`DELETE FROM attendance_record WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[])
    AND provenance->>'demoFixture' = ${marker}`);
  await tx.query(sql`DELETE FROM attendance_month_summary WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[])`);
  await tx.query(sql`DELETE FROM shift_assignment WHERE organization_id = ${organizationId} AND user_id = ANY(${ids}::uuid[]) AND reason = ${marker}`);
  await tx.query(sql`DELETE FROM shift_version WHERE organization_id = ${organizationId} AND shift_id IN
    (SELECT id FROM shift WHERE organization_id = ${organizationId} AND code = 'DEMO-DAY')`);
  await tx.query(sql`DELETE FROM shift WHERE organization_id = ${organizationId} AND code = 'DEMO-DAY'`);
  await tx.query(sql`DELETE FROM leave_type WHERE organization_id = ${organizationId} AND code = 'DEMO-ANNUAL'`);
  await tx.query(sql`DELETE FROM domain_outbox WHERE organization_id = ${organizationId} AND event_name = 'attendance.day-changed'
    AND payload->>'userId' = ANY(${ids}::text[])`);
}
