/* eslint-disable @typescript-eslint/no-explicit-any */
import { db, type Tx } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationToday } from '../../platform/organization-time.js';
import { xlsxBuffer } from '../attendance/export.js';
import { writeTaAudit } from './audit.js';
import { TaConflictError, TaError } from './errors.js';
import type { AssignmentBody, ListQuery } from './validators.js';

const dayBefore = (month: string): string => {
  const date = new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
};

async function employeeAndDepartment(
  tx: Tx,
  ctx: RequestContext,
  body: AssignmentBody,
): Promise<void> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT u.id
    FROM app_user u
    WHERE u.organization_id=${ctx.organizationId}
      AND u.id=${body.employeeId}::uuid
      AND u.account_type='employee'
      AND u.status='active'
      AND u.department_id=${body.departmentId}::uuid
    FOR UPDATE
  `);
  if (!row)
    throw new TaError(
      'Employee does not belong to the selected department or is inactive.',
    );
  const department = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM department
    WHERE organization_id=${ctx.organizationId} AND id=${body.departmentId}::uuid AND status='active'
  `);
  if (!department) throw new TaError('Selected department is not active.');
}

async function overlappingAssignment(
  tx: Tx,
  ctx: RequestContext,
  employeeId: string,
  taMonth: string,
  from: string,
  to: string | null,
  excludeId: string | null = null,
): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM ta_assignment
    WHERE organization_id=${ctx.organizationId}
      AND employee_id=${employeeId}::uuid
      AND ta_month=${taMonth}::date
      AND status='active'
      AND (${excludeId ?? null}::uuid IS NULL OR id <> ${excludeId ?? null}::uuid)
      AND effective_from <= COALESCE(${to ?? null}::date, ${from}::date)
      AND COALESCE(effective_to, ${dayBefore(taMonth)}::date) >= ${from}::date
    LIMIT 1
  `);
  return row !== null;
}

async function calculateStatement(
  tx: Tx,
  ctx: RequestContext,
  assignmentId: string,
  taMonth: string,
): Promise<{ id: string }> {
  const row = await tx.one<{
    id: string;
    employeeId: string;
    dailyAmountPaise: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  }>(sql`
    SELECT id, employee_id AS "employeeId", daily_amount_paise::text AS "dailyAmountPaise",
      effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo", status
    FROM ta_assignment
    WHERE organization_id=${ctx.organizationId} AND id=${assignmentId}::uuid AND ta_month=${taMonth}::date
    FOR UPDATE
  `);
  if (row.status === 'inactive') {
    const today = await organizationToday(tx);
    if (taMonth > `${today.slice(0, 7)}-01`)
      throw new TaError(
        'Inactive TA assignments cannot be calculated for a future month.',
      );
  }
  const attendance = await tx.one<{
    presentDays: string;
    halfDays: string;
    absentDays: string;
    leaveDays: string;
    holidayDays: string;
    eligibleDays: string;
  }>(sql`
    SELECT
      COALESCE(count(*) FILTER (WHERE r.status='present'), 0)::text AS "presentDays",
      COALESCE(sum(CASE WHEN r.present_units=1 THEN 1 ELSE 0 END), 0)::text AS "halfDays",
      COALESCE(sum(r.absent_units), 0)::numeric / 2::numeric AS "absentDays",
      COALESCE(sum(r.paid_leave_units + r.unpaid_leave_units), 0)::numeric / 2::numeric AS "leaveDays",
      COALESCE(sum(r.holiday_units), 0)::numeric / 2::numeric AS "holidayDays",
      COALESCE(sum(r.present_units), 0)::numeric / 2::numeric AS "eligibleDays"
    FROM attendance_record r
    WHERE r.organization_id=${ctx.organizationId}
      AND r.user_id=${row.employeeId}::uuid
      AND r.work_date BETWEEN ${row.effectiveFrom}::date AND COALESCE(${row.effectiveTo ?? null}::date, ${dayBefore(taMonth)}::date)
      AND r.work_date >= ${taMonth}::date
      AND r.work_date <= ${dayBefore(taMonth)}::date
      AND r.status IS NOT NULL
  `);
  const statement = await tx.one<{ id: string }>(sql`
    INSERT INTO ta_statement
      (organization_id, employee_id, assignment_id, ta_month, daily_amount_paise,
       effective_from, effective_to, present_days, half_days, absent_days,
       leave_days, holiday_days, eligible_days, calculated_amount_paise,
       status, recalculated_at, updated_at)
    VALUES
      (${ctx.organizationId}, ${row.employeeId}::uuid, ${row.id}::uuid, ${taMonth}::date,
       ${row.dailyAmountPaise}, ${row.effectiveFrom}::date, ${row.effectiveTo ?? null}::date,
       ${attendance.presentDays}, ${attendance.halfDays}, ${attendance.absentDays},
       ${attendance.leaveDays}, ${attendance.holidayDays}, ${attendance.eligibleDays},
       (${row.dailyAmountPaise}::numeric * ${attendance.eligibleDays}::numeric)::bigint,
       'draft', now(), now())
    ON CONFLICT (organization_id, employee_id, assignment_id, ta_month)
    DO UPDATE SET daily_amount_paise=EXCLUDED.daily_amount_paise,
      effective_from=EXCLUDED.effective_from, effective_to=EXCLUDED.effective_to,
      present_days=EXCLUDED.present_days, half_days=EXCLUDED.half_days,
      absent_days=EXCLUDED.absent_days, leave_days=EXCLUDED.leave_days,
      holiday_days=EXCLUDED.holiday_days, eligible_days=EXCLUDED.eligible_days,
      calculated_amount_paise=EXCLUDED.calculated_amount_paise,
      recalculated_at=now(), updated_at=now()
    RETURNING id
  `);
  await writeTaAudit(tx, ctx, 'ta.statement.recalculated', 'taStatement', statement.id, {
    assignmentId: row.id,
    employeeId: row.employeeId,
    taMonth,
    eligibleDays: attendance.eligibleDays,
    calculatedAmountPaise: `${row.dailyAmountPaise} * ${attendance.eligibleDays}`,
  });
  return statement;
}

export async function listAssignments(ctx: RequestContext) {
  return db.query<any>(
    ctx,
    sql`
    SELECT a.id, a.employee_id AS "employeeId", u.full_name AS "employeeName",
      u.employee_id AS "employeeCode", a.department_id AS "departmentId", d.name AS "departmentName",
      a.ta_month::text AS "taMonth", a.daily_amount_paise::text AS "dailyAmountPaise",
      a.effective_from::text AS "effectiveFrom", a.effective_to::text AS "effectiveTo", a.status, a.remarks
    FROM ta_assignment a
    JOIN app_user u ON u.organization_id=a.organization_id AND u.id=a.employee_id
    JOIN department d ON d.organization_id=a.organization_id AND d.id=a.department_id
    WHERE a.organization_id=${ctx.organizationId}
    ORDER BY a.ta_month DESC, u.full_name, a.effective_from
  `,
  );
}

export async function createAssignment(ctx: RequestContext, body: AssignmentBody) {
  return db.transaction(ctx, async (tx) => {
    await employeeAndDepartment(tx, ctx, body);
    if (
      await overlappingAssignment(
        tx,
        ctx,
        body.employeeId,
        body.taMonth,
        body.effectiveFrom,
        body.effectiveTo ?? null,
      )
    )
      throw new TaConflictError(
        'This employee already has an overlapping active TA assignment for the selected month.',
      );
    const row = await tx.one<{ id: string }>(sql`
      INSERT INTO ta_assignment
        (organization_id, employee_id, department_id, ta_month, daily_amount_paise,
         effective_from, effective_to, remarks, created_by, updated_by)
      VALUES
        (${ctx.organizationId}, ${body.employeeId}::uuid, ${body.departmentId}::uuid,
         ${body.taMonth}::date, ${body.dailyAmountPaise}, ${body.effectiveFrom}::date,
         ${body.effectiveTo ?? null}::date, ${body.remarks ?? null},
         ${ctx.principal.id}::uuid, ${ctx.principal.id}::uuid)
      RETURNING id
    `);
    await writeTaAudit(tx, ctx, 'ta.assignment.created', 'taAssignment', row.id, body);
    return row;
  });
}

function reportWhere(ctx: RequestContext, q: ListQuery) {
  return sql`a.organization_id=${ctx.organizationId}
    AND a.ta_month=${q.taMonth}::date
    AND (${q.departmentId ?? null}::uuid IS NULL OR a.department_id=${q.departmentId ?? null}::uuid)
    AND (${q.search ?? null}::text IS NULL OR u.full_name ILIKE '%'||${q.search ?? null}||'%' OR u.employee_id ILIKE '%'||${q.search ?? null}||'%')
    AND (${q.status}='all' OR COALESCE(s.status, 'draft')=${q.status})`;
}

async function reportRows(ctx: RequestContext, q: ListQuery, paginate: boolean) {
  const where = reportWhere(ctx, q);
  return db.query<any>(
    ctx,
    sql`
    SELECT a.id AS "assignmentId", u.id AS "employeeId", u.full_name AS "employeeName",
      u.employee_id AS "employeeCode", d.id AS "departmentId", d.name AS "departmentName",
      t.name AS "teamName", p.name AS "positionName", a.ta_month::text AS "taMonth",
      a.daily_amount_paise::text AS "dailyAmountPaise", a.effective_from::text AS "effectiveFrom",
      a.effective_to::text AS "effectiveTo", a.status AS "assignmentStatus",
      s.id AS "statementId", COALESCE(s.status, 'draft') AS status,
      COALESCE(s.present_days, 0)::text AS "presentDays", COALESCE(s.half_days, 0)::text AS "halfDays",
      COALESCE(s.absent_days, 0)::text AS "absentDays", COALESCE(s.leave_days, 0)::text AS "leaveDays",
      COALESCE(s.holiday_days, 0)::text AS "holidayDays", COALESCE(s.eligible_days, 0)::text AS "eligibleDays",
      COALESCE(s.calculated_amount_paise, 0)::text AS "calculatedAmountPaise",
      s.recalculated_at::text AS "recalculatedAt", s.sent_at::text AS "sentAt", sb.full_name AS "sentByName"
    FROM ta_assignment a
    JOIN app_user u ON u.organization_id=a.organization_id AND u.id=a.employee_id
    JOIN department d ON d.organization_id=a.organization_id AND d.id=a.department_id
    LEFT JOIN team t ON t.organization_id=u.organization_id AND t.id=u.team_id
    LEFT JOIN position p ON p.organization_id=u.organization_id AND p.id=u.position_id
    LEFT JOIN ta_statement s ON s.organization_id=a.organization_id AND s.assignment_id=a.id AND s.ta_month=a.ta_month
    LEFT JOIN app_user sb ON sb.organization_id=s.organization_id AND sb.id=s.sent_by
    WHERE ${where}
    ORDER BY u.full_name, a.effective_from
    ${paginate ? sql`LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}` : sql``}
  `,
  );
}

export async function listReport(ctx: RequestContext, q: ListQuery) {
  const [rows, count] = await Promise.all([
    reportRows(ctx, q, true),
    db.one<{ count: string }>(
      ctx,
      sql`SELECT count(*)::text AS count FROM ta_assignment a JOIN app_user u ON u.organization_id=a.organization_id AND u.id=a.employee_id LEFT JOIN ta_statement s ON s.organization_id=a.organization_id AND s.assignment_id=a.id AND s.ta_month=a.ta_month WHERE ${reportWhere(ctx, q)}`,
    ),
  ]);
  return { rows, total: Number(count.count), page: q.page, pageSize: q.pageSize };
}

export async function recalculate(
  ctx: RequestContext,
  taMonth: string,
  assignmentIds: string[],
) {
  return db.transaction(ctx, async (tx) => {
    const assignments = await tx.query<{ id: string }>(sql`
      SELECT id FROM ta_assignment
      WHERE organization_id=${ctx.organizationId} AND id=ANY(${assignmentIds}::uuid[]) AND ta_month=${taMonth}::date
      FOR UPDATE
    `);
    if (assignments.length !== assignmentIds.length)
      throw new TaError(
        'Every selected TA assignment must belong to this organization and month.',
      );
    const statements = [];
    for (const assignment of assignments)
      statements.push(await calculateStatement(tx, ctx, assignment.id, taMonth));
    return { recalculated: statements.length };
  });
}

export async function send(ctx: RequestContext, statementIds: string[]) {
  return db.transaction(ctx, async (tx) => {
    const rows = await tx.query<{
      id: string;
      status: string;
      recalculatedAt: string | null;
      calculatedAmountPaise: string;
    }>(sql`
      SELECT id, status, recalculated_at::text AS "recalculatedAt", calculated_amount_paise::text AS "calculatedAmountPaise"
      FROM ta_statement WHERE organization_id=${ctx.organizationId} AND id=ANY(${statementIds}::uuid[]) FOR UPDATE
    `);
    if (rows.length !== statementIds.length)
      throw new TaError('Every selected TA statement must belong to this organization.');
    for (const row of rows) {
      if (!row.recalculatedAt)
        throw new TaError('TA must be recalculated before it can be sent.');
      if (row.status === 'sent') continue;
      await tx.query(
        sql`UPDATE ta_statement SET status='sent', sent_at=now(), sent_by=${ctx.principal.id}::uuid, updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${row.id}::uuid`,
      );
      await writeTaAudit(tx, ctx, 'ta.statement.sent', 'taStatement', row.id, {
        calculatedAmountPaise: row.calculatedAmountPaise,
      });
    }
    return { sent: rows.length };
  });
}

export async function changeAssignmentStatus(
  ctx: RequestContext,
  id: string,
  status: 'active' | 'inactive',
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{
      employeeId: string;
      taMonth: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      status: string;
    }>(
      sql`SELECT employee_id AS "employeeId", ta_month::text AS "taMonth", effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo", status FROM ta_assignment WHERE organization_id=${ctx.organizationId} AND id=${id}::uuid FOR UPDATE`,
    );
    if (row.status === status)
      throw new TaError(`This TA assignment is already ${status}.`);
    await tx.query(
      sql`SELECT id FROM app_user WHERE organization_id=${ctx.organizationId} AND id=${row.employeeId}::uuid FOR UPDATE`,
    );
    if (
      status === 'active' &&
      (await overlappingAssignment(
        tx,
        ctx,
        row.employeeId,
        row.taMonth,
        row.effectiveFrom,
        row.effectiveTo,
        id,
      ))
    )
      throw new TaConflictError(
        'This employee already has an overlapping active TA assignment for the selected month.',
      );
    await tx.query(
      sql`UPDATE ta_assignment SET status=${status}, updated_by=${ctx.principal.id}::uuid, updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id}::uuid`,
    );
    await writeTaAudit(
      tx,
      ctx,
      `ta.assignment.${status === 'active' ? 'reactivated' : 'deactivated'}`,
      'taAssignment',
      id,
      { status },
    );
  });
}

export async function myStatements(ctx: RequestContext, taMonth: string) {
  return db.transaction(ctx, async (tx) => {
    const statements = await tx.query<any>(sql`
      SELECT s.id, s.ta_month::text AS "taMonth", s.daily_amount_paise::text AS "dailyAmountPaise",
        s.effective_from::text AS "effectiveFrom", s.effective_to::text AS "effectiveTo",
        s.present_days::text AS "presentDays", s.half_days::text AS "halfDays", s.absent_days::text AS "absentDays",
        s.leave_days::text AS "leaveDays", s.holiday_days::text AS "holidayDays", s.eligible_days::text AS "eligibleDays",
        s.calculated_amount_paise::text AS "calculatedAmountPaise", s.status, s.sent_at::text AS "sentAt"
      FROM ta_statement s
      WHERE s.organization_id=${ctx.organizationId} AND s.employee_id=${ctx.principal.id}::uuid AND s.ta_month=${taMonth}::date AND s.status='sent'
      ORDER BY s.effective_from
    `);
    const days = await tx.query<any>(sql`
      SELECT r.work_date::text AS "workDate", r.status, r.present_units AS "presentUnits",
        CASE WHEN r.present_units > 0 THEN r.present_units::numeric / 2 ELSE 0 END AS "eligibleUnits",
        s.daily_amount_paise::text AS "dailyAmountPaise"
      FROM attendance_record r
      LEFT JOIN ta_statement s
        ON s.organization_id=r.organization_id
        AND s.employee_id=r.user_id
        AND s.ta_month=${taMonth}::date
        AND s.status='sent'
        AND r.work_date >= s.effective_from
        AND r.work_date <= COALESCE(s.effective_to, (${taMonth}::date + interval '1 month - 1 day')::date)
      WHERE r.organization_id=${ctx.organizationId} AND r.user_id=${ctx.principal.id}::uuid
        AND r.work_date >= ${taMonth}::date AND r.work_date < (${taMonth}::date + interval '1 month')
      ORDER BY r.work_date
    `);
    return { statements, days };
  });
}

export async function exportReport(
  ctx: RequestContext,
  q: ListQuery,
  format: 'csv' | 'xlsx',
) {
  const rows = await reportRows(ctx, q, false);
  const headers = [
    'Employee ID',
    'Employee',
    'Department',
    'Team',
    'Position',
    'TA Month',
    'Daily TA',
    'Effective From',
    'Effective To',
    'Present Days',
    'Half Days',
    'Absent Days',
    'Leave Days',
    'Holiday Days',
    'Eligible TA Days',
    'Calculated TA',
    'Status',
    'Sent At',
    'Sent By',
  ];
  const values = rows.map((r: any) => [
    r.employeeCode ?? '',
    r.employeeName,
    r.departmentName,
    r.teamName ?? '',
    r.positionName ?? '',
    r.taMonth,
    Number(r.dailyAmountPaise) / 100,
    r.effectiveFrom,
    r.effectiveTo ?? '',
    r.presentDays,
    r.halfDays,
    r.absentDays,
    r.leaveDays,
    r.holidayDays,
    r.eligibleDays,
    Number(r.calculatedAmountPaise) / 100,
    r.status,
    r.sentAt ?? '',
    r.sentByName ?? '',
  ]);
  await db.transaction(ctx, (tx) =>
    writeTaAudit(tx, ctx, 'ta.exported', 'taReport', ctx.requestId, {
      taMonth: q.taMonth,
      rowCount: rows.length,
    }),
  );
  if (format === 'xlsx')
    return {
      body: xlsxBuffer([headers, ...values]),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `ta-${q.taMonth.slice(0, 7)}.xlsx`,
    };
  const csv = [headers, ...values]
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','),
    )
    .join('\r\n');
  return {
    body: Buffer.from(`${csv}\r\n`),
    contentType: 'text/csv; charset=utf-8',
    filename: `ta-${q.taMonth.slice(0, 7)}.csv`,
  };
}
