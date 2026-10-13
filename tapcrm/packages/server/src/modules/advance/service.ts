import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { notify } from '../notifications/facade.js';
import { xlsxBuffer } from '../attendance/export.js';
import { writeAdvanceAudit } from './audit.js';
import { AdvanceError } from './errors.js';
import type { AdvanceRow, DeductionRow } from './types.js';
import type {
  ApproveAdvanceBody,
  DeductionBody,
  ListAdvanceQuery,
  ListDeductionQuery,
  ManualAdvanceBody,
  RejectAdvanceBody,
  RequestAdvanceBody,
} from './validators.js';

const advanceSelect = sql.raw(`
  SELECT a.id, a.organization_id AS "organizationId", a.employee_id AS "employeeId", u.employee_id AS "employeeCode", u.full_name AS "employeeName",
    d.name AS "departmentName", t.name AS "teamName", p.name AS "positionName", a.requested_amount_paise::text AS "requestedAmountPaise",
    a.approved_amount_paise::text AS "approvedAmountPaise", a.requested_for_period::text AS "requestedForPeriod", a.requested_at::text AS "requestedAt",
    a.status, a.source, a.reason, a.approved_at::text AS "approvedAt", a.approved_by AS "approvedBy", ab.full_name AS "approvedByName",
    a.rejected_at::text AS "rejectedAt", a.rejected_by AS "rejectedBy", rb.full_name AS "rejectedByName", a.rejection_reason AS "rejectionReason", a.approval_note AS "approvalNote",
    COALESCE((SELECT SUM(dd.deducted_amount_paise) FROM employee_advance_deduction dd WHERE dd.organization_id=a.organization_id AND dd.advance_id=a.id AND dd.status <> 'cancelled'), 0)::text AS "recoveredAmountPaise",
    (COALESCE(a.approved_amount_paise, 0) - COALESCE((SELECT SUM(dd.deducted_amount_paise) FROM employee_advance_deduction dd WHERE dd.organization_id=a.organization_id AND dd.advance_id=a.id AND dd.status <> 'cancelled'), 0))::text AS "outstandingAmountPaise"
  FROM employee_advance a JOIN app_user u ON u.organization_id=a.organization_id AND u.id=a.employee_id
  LEFT JOIN department d ON d.organization_id=u.organization_id AND d.id=u.department_id LEFT JOIN team t ON t.organization_id=u.organization_id AND t.id=u.team_id LEFT JOIN position p ON p.organization_id=u.organization_id AND p.id=u.position_id
  LEFT JOIN app_user ab ON ab.organization_id=a.organization_id AND ab.id=a.approved_by LEFT JOIN app_user rb ON rb.organization_id=a.organization_id AND rb.id=a.rejected_by`);

function filters(query: ListAdvanceQuery, ownId?: string): ReturnType<typeof sql> {
  const parts = [sql`a.organization_id = current_organization_id()`];
  if (ownId) parts.push(sql`a.employee_id = ${ownId}`);
  if (query.status && query.status !== 'all') parts.push(sql`a.status = ${query.status}`);
  if (query.month) parts.push(sql`a.requested_for_period = ${query.month}::date`);
  if (query.search)
    parts.push(
      sql`(u.full_name ILIKE ${`%${query.search}%`} OR u.employee_id ILIKE ${`%${query.search}%`})`,
    );
  return sql.join(parts, ' AND ');
}

export async function listAdvances(
  ctx: RequestContext,
  query: ListAdvanceQuery,
  own = false,
): Promise<{ rows: AdvanceRow[]; total: number }> {
  return db.transaction(ctx, async (tx) => {
    const where = filters(query, own ? ctx.principal.id : undefined);
    const count = await tx.one<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM employee_advance a JOIN app_user u ON u.organization_id=a.organization_id AND u.id=a.employee_id WHERE ${where}`,
    );
    const rows = await tx.query<AdvanceRow>(
      sql`${advanceSelect} WHERE ${where} ORDER BY a.requested_at DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    );
    return { rows, total: count.total };
  });
}

export async function getAdvance(ctx: RequestContext, id: string): Promise<AdvanceRow> {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<AdvanceRow>(
      sql`${advanceSelect} WHERE a.organization_id = ${ctx.organizationId} AND a.id = ${id}`,
    );
    if (
      !row ||
      (row.employeeId !== ctx.principal.id && ctx.principal.accountType !== 'super-admin')
    )
      throw new AdvanceError('Advance not found.');
    return row;
  });
}

export async function requestAdvance(
  ctx: RequestContext,
  body: RequestAdvanceBody,
): Promise<AdvanceRow> {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO employee_advance (organization_id, employee_id, requested_amount_paise, requested_for_period, reason, created_by) VALUES (${ctx.organizationId}, ${ctx.principal.id}, ${body.amountPaise}, ${body.requestedForPeriod}::date, ${body.reason}, ${ctx.principal.id}) RETURNING id`,
    );
    await writeAdvanceAudit(tx, ctx, 'advance.requested', 'employeeAdvance', row.id, {
      requestedAmountPaise: body.amountPaise,
      requestedForPeriod: body.requestedForPeriod,
    });
    await notify(tx, ctx, {
      type: 'advance.requested',
      priority: 'operational',
      audience: { holders: { action: 'advance:approve' } },
      title: 'New advance request',
      body: 'An employee advance request is ready for review.',
      link: `/company/advance/requests`,
      metadata: { advanceId: row.id },
    });
    return tx.one<AdvanceRow>(sql`${advanceSelect} WHERE a.id = ${row.id}`);
  });
}

export async function approveAdvance(
  ctx: RequestContext,
  id: string,
  body: ApproveAdvanceBody,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{
      requestedAmountPaise: string;
      employeeId: string;
    }>(
      sql`SELECT requested_amount_paise::text AS "requestedAmountPaise", employee_id AS "employeeId" FROM employee_advance WHERE organization_id=${ctx.organizationId} AND id=${id} AND status='pending' FOR UPDATE`,
    );
    if (!current) throw new AdvanceError('Only a pending advance can be approved.');
    if (BigInt(body.approvedAmountPaise) > BigInt(current.requestedAmountPaise))
      throw new AdvanceError('Approved amount cannot exceed the requested amount.');
    await tx.query(
      sql`UPDATE employee_advance SET status='approved', approved_amount_paise=${body.approvedAmountPaise}, approved_at=now(), approved_by=${ctx.principal.id}, approval_note=${body.approvalNote ?? null}, updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id} AND status='pending'`,
    );
    await writeAdvanceAudit(tx, ctx, 'advance.approved', 'employeeAdvance', id, {
      requestedAmountPaise: current.requestedAmountPaise,
      approvedAmountPaise: body.approvedAmountPaise,
      // Audit payloads are JSON; preserve exact paise arithmetic as a string
      // because JSON.stringify cannot serialize BigInt values.
      difference: (
        BigInt(current.requestedAmountPaise) - BigInt(body.approvedAmountPaise)
      ).toString(),
      approvedBy: ctx.principal.id,
    });
    await notify(tx, ctx, {
      type: 'advance.approved',
      audience: { users: [current.employeeId] },
      title: 'Advance approved',
      body: `Your advance request has been approved for ₹${(body.approvedAmountPaise / 100).toFixed(2)}.`,
      link: `/company/advance/mine`,
      metadata: { advanceId: id },
    });
  });
}

export async function rejectAdvance(
  ctx: RequestContext,
  id: string,
  body: RejectAdvanceBody,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{
      requestedAmountPaise: string;
      employeeId: string;
    }>(
      sql`SELECT requested_amount_paise::text AS "requestedAmountPaise", employee_id AS "employeeId" FROM employee_advance WHERE organization_id=${ctx.organizationId} AND id=${id} AND status='pending' FOR UPDATE`,
    );
    if (!current) throw new AdvanceError('Only a pending advance can be rejected.');
    await tx.query(
      sql`UPDATE employee_advance SET status='rejected', rejected_at=now(), rejected_by=${ctx.principal.id}, rejection_reason=${body.rejectionReason}, updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id} AND status='pending'`,
    );
    await writeAdvanceAudit(tx, ctx, 'advance.rejected', 'employeeAdvance', id, {
      requestedAmountPaise: current.requestedAmountPaise,
      rejectionReason: body.rejectionReason,
      rejectedBy: ctx.principal.id,
    });
    await notify(tx, ctx, {
      type: 'advance.rejected',
      audience: { users: [current.employeeId] },
      title: 'Advance request rejected',
      body: 'Your advance request was rejected.',
      link: `/company/advance/mine`,
      metadata: { advanceId: id },
    });
  });
}

export async function createManualAdvance(
  ctx: RequestContext,
  body: ManualAdvanceBody,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO employee_advance (organization_id, employee_id, requested_amount_paise, approved_amount_paise, requested_for_period, reason, status, source, approved_at, approved_by, created_by) VALUES (${ctx.organizationId}, ${body.employeeId}, ${body.amountPaise}, ${body.amountPaise}, ${body.requestedForPeriod}::date, ${body.reason}, 'approved', 'manual', now(), ${ctx.principal.id}, ${ctx.principal.id}) RETURNING id`,
    );
    await writeAdvanceAudit(
      tx,
      ctx,
      'advance.created-manually',
      'employeeAdvance',
      row.id,
      { employeeId: body.employeeId, amountPaise: body.amountPaise },
    );
    await notify(tx, ctx, {
      type: 'advance.created-manually',
      audience: { users: [body.employeeId] },
      title: 'Advance created',
      body: `An advance of ₹${(body.amountPaise / 100).toFixed(2)} has been created for you.`,
      link: `/company/advance/mine`,
      metadata: { advanceId: row.id },
    });
  });
}

export async function listDeductions(
  ctx: RequestContext,
  query: ListDeductionQuery,
): Promise<{ rows: DeductionRow[]; total: number }> {
  return db.transaction(ctx, async (tx) => {
    const parts = [
      sql`d.organization_id=${ctx.organizationId}`,
      sql`a.status='approved'`,
    ];
    if (query.status && query.status !== 'all') parts.push(sql`d.status=${query.status}`);
    if (query.month) parts.push(sql`d.payroll_period=${query.month}::date`);
    if (query.search)
      parts.push(
        sql`(u.full_name ILIKE ${`%${query.search}%`} OR u.employee_id ILIKE ${`%${query.search}%`})`,
      );
    const where = sql.join(parts, ' AND ');
    const base = sql.raw(
      `FROM employee_advance_deduction d JOIN employee_advance a ON a.organization_id=d.organization_id AND a.id=d.advance_id JOIN app_user u ON u.organization_id=d.organization_id AND u.id=d.employee_id LEFT JOIN department dep ON dep.organization_id=u.organization_id AND dep.id=u.department_id LEFT JOIN team t ON t.organization_id=u.organization_id AND t.id=u.team_id LEFT JOIN position p ON p.organization_id=u.organization_id AND p.id=u.position_id`,
    );
    const count = await tx.one<{ total: number }>(
      sql`SELECT count(*)::int AS total ${base} WHERE ${where}`,
    );
    const rows = await tx.query<DeductionRow>(
      sql`SELECT d.id, d.advance_id AS "advanceId", d.employee_id AS "employeeId", u.employee_id AS "employeeCode", u.full_name AS "employeeName", dep.name AS "departmentName", t.name AS "teamName", p.name AS "positionName", a.requested_amount_paise::text AS "requestedAmountPaise", a.approved_amount_paise::text AS "approvedAmountPaise", a.approved_at::text AS "approvedAt", a.requested_for_period::text AS "requestedForPeriod", d.payroll_period::text AS "payrollPeriod", d.scheduled_amount_paise::text AS "scheduledAmountPaise", d.deducted_amount_paise::text AS "deductedAmountPaise", (a.approved_amount_paise - COALESCE((SELECT SUM(x.deducted_amount_paise) FROM employee_advance_deduction x WHERE x.organization_id=d.organization_id AND x.advance_id=d.advance_id AND x.status <> 'cancelled'),0))::text AS "outstandingAmountPaise", d.status ${base} WHERE ${where} ORDER BY d.payroll_period, u.full_name LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    );
    return { rows, total: count.total };
  });
}

export async function createDeduction(
  ctx: RequestContext,
  advanceId: string,
  body: DeductionBody,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const advance = await tx.one<{ employeeId: string; approvedAmountPaise: string }>(
      sql`SELECT employee_id AS "employeeId", approved_amount_paise::text AS "approvedAmountPaise" FROM employee_advance WHERE organization_id=${ctx.organizationId} AND id=${advanceId} AND status='approved' FOR UPDATE`,
    );
    const used = await tx.one<{ amount: string }>(
      sql`SELECT COALESCE(SUM(scheduled_amount_paise),0)::text AS amount FROM employee_advance_deduction WHERE organization_id=${ctx.organizationId} AND advance_id=${advanceId} AND status <> 'cancelled'`,
    );
    if (
      BigInt(used.amount) + BigInt(body.scheduledAmountPaise) >
      BigInt(advance.approvedAmountPaise)
    )
      throw new AdvanceError('Scheduled deductions cannot exceed the approved balance.');
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO employee_advance_deduction (organization_id, advance_id, employee_id, payroll_period, scheduled_amount_paise) VALUES (${ctx.organizationId}, ${advanceId}, ${advance.employeeId}, ${body.payrollPeriod}::date, ${body.scheduledAmountPaise}) RETURNING id`,
    );
    await writeAdvanceAudit(
      tx,
      ctx,
      'advance.deduction-created',
      'employeeAdvanceDeduction',
      row.id,
      {
        advanceId,
        employeeId: advance.employeeId,
        payrollPeriod: body.payrollPeriod,
        scheduledAmountPaise: body.scheduledAmountPaise,
      },
    );
  });
}

export async function exportDeductions(
  ctx: RequestContext,
  query: ListDeductionQuery,
  format: 'csv' | 'xlsx',
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const data = await listDeductions(ctx, { ...query, page: 1, pageSize: 10000 });
  const headers = [
    'Advance ID',
    'Employee ID',
    'Employee Name',
    'Department',
    'Team',
    'Position',
    'Requested Amount',
    'Approved Amount',
    'Approved Date',
    'Advance Month',
    'Deduction Month',
    'Scheduled Deduction',
    'Deducted Amount',
    'Outstanding Amount',
    'Deduction Status',
  ];
  const values = data.rows.map((r) => [
    r.advanceId,
    r.employeeCode ?? '',
    r.employeeName,
    r.departmentName ?? '',
    r.teamName ?? '',
    r.positionName ?? '',
    Number(r.requestedAmountPaise) / 100,
    Number(r.approvedAmountPaise) / 100,
    r.approvedAt ?? '',
    r.requestedForPeriod,
    r.payrollPeriod,
    Number(r.scheduledAmountPaise) / 100,
    Number(r.deductedAmountPaise) / 100,
    Number(r.outstandingAmountPaise) / 100,
    r.status,
  ]);
  if (format === 'xlsx')
    return {
      body: xlsxBuffer([headers, ...values]),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'advance-deductions.xlsx',
    };
  const csv = [headers, ...values]
    .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  return {
    body: Buffer.from(`${csv}\r\n`),
    contentType: 'text/csv; charset=utf-8',
    filename: 'advance-deductions.csv',
  };
}

/** Export approved advances for the payroll handoff view. */
export async function exportApprovedAdvances(
  ctx: RequestContext,
  query: ListAdvanceQuery,
  format: 'csv' | 'xlsx',
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const data = await listAdvances(ctx, {
    ...query,
    status: 'approved',
    page: 1,
    pageSize: 10000,
  });
  const headers = [
    'Advance ID',
    'Employee ID',
    'Employee Name',
    'Department',
    'Team',
    'Position',
    'Approved Amount',
    'Recovered Amount',
    'Outstanding Amount',
    'Advance Month',
    'Approved Date',
    'Reason',
  ];
  const values = data.rows.map((r) => [
    r.id,
    r.employeeCode ?? '',
    r.employeeName,
    r.departmentName ?? '',
    r.teamName ?? '',
    r.positionName ?? '',
    Number(r.approvedAmountPaise ?? 0) / 100,
    Number(r.recoveredAmountPaise) / 100,
    Number(r.outstandingAmountPaise) / 100,
    r.requestedForPeriod,
    r.approvedAt ?? '',
    r.reason,
  ]);
  if (format === 'xlsx')
    return {
      body: xlsxBuffer([headers, ...values]),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'approved-advances.xlsx',
    };
  const csv = [headers, ...values]
    .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  return {
    body: Buffer.from(`${csv}\r\n`),
    contentType: 'text/csv; charset=utf-8',
    filename: 'approved-advances.csv',
  };
}
