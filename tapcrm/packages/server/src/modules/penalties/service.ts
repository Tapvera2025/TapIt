import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { xlsxBuffer } from '../attendance/export.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/facade.js';
import { writePenaltyAudit } from './audit.js';
import { PenaltyError } from './errors.js';
import * as repo from './repository.js';
import type { PenaltyRow } from './types.js';
import type {
  CancelPenaltyBody,
  CreatePenaltyBody,
  ListPenaltyQuery,
} from './validators.js';

export async function listPenalties(
  ctx: RequestContext,
  query: ListPenaltyQuery,
  own = false,
) {
  const visibility = own
    ? sql`p.employee_id = ${ctx.principal.id}`
    : await visibilityFilter(ctx, 'penalty:view', 'employeePenalty');
  return repo.listPenalties(ctx, query, visibility);
}

export async function exportPenalties(
  ctx: RequestContext,
  query: ListPenaltyQuery,
  format: 'csv' | 'xlsx',
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const visibility = await visibilityFilter(ctx, 'penalty:export', 'employeePenalty');
  const rows = await repo.exportPenalties(ctx, query, visibility);
  const headers = [
    'Employee ID', 'Employee Name', 'Department', 'Team', 'Position',
    'Penalty Type', 'Amount', 'Penalty Date', 'Payroll Month', 'Payroll Status',
    'Status', 'Remarks',
  ];
  const values = rows.map((row) => [
    row.employeeCode ?? '', row.employeeName, row.departmentName ?? '', row.teamName ?? '',
    row.positionName ?? '', row.penaltyType, Number(row.amountPaise) / 100, row.penaltyDate,
    row.payrollPeriod, row.payrollStatus, row.status, row.remarks,
  ]);
  await db.transaction(ctx, (tx) =>
    writePenaltyAudit(tx, ctx, 'penalty.exported', ctx.requestId, {
      filters: query,
      rowCount: rows.length,
    }),
  );
  if (format === 'xlsx') {
    return {
      body: xlsxBuffer([headers, ...values]),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'employee-penalties.xlsx',
    };
  }
  const csv = [headers, ...values]
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  return { body: Buffer.from(`${csv}\r\n`), contentType: 'text/csv; charset=utf-8', filename: 'employee-penalties.csv' };
}

export async function getPenalty(ctx: RequestContext, id: string): Promise<PenaltyRow> {
  const row = await repo.findPenalty(ctx, id);
  if (!row || row.employeeId !== ctx.principal.id)
    throw new PenaltyError('Penalty not found.');
  return row;
}

export async function getManagedPenalty(
  ctx: RequestContext,
  id: string,
): Promise<PenaltyRow> {
  const row = await repo.findPenalty(ctx, id);
  if (!row) throw new PenaltyError('Penalty not found.');
  return row;
}

export async function createPenalty(
  ctx: RequestContext,
  body: CreatePenaltyBody,
): Promise<PenaltyRow> {
  const id = await db.transaction(ctx, async (tx) => {
    if (!(await repo.employeeExists(tx, ctx.organizationId, body.employeeId)))
      throw new PenaltyError('Employee must be an active employee in this organization.');
    const id = await repo.insertPenalty(tx, ctx.organizationId, body, ctx.principal.id);
    await writePenaltyAudit(tx, ctx, 'penalty.created', id, {
      employeeId: body.employeeId,
      penaltyType: body.penaltyType,
      amountPaise: body.amountPaise,
      penaltyDate: body.penaltyDate,
      payrollPeriod: body.payrollPeriod,
      remarks: body.remarks,
    });
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.PENALTY_CREATED,
      priority: 'operational',
      audience: { users: [body.employeeId] },
      title: 'Penalty recorded',
      body: `A penalty of ₹${(body.amountPaise / 100).toFixed(2)} has been recorded against your account.`,
      link: '/company/my-penalties',
      metadata: { penaltyId: id },
    });
    return id;
  });
  const created = await repo.findPenalty(ctx, id);
  if (!created) throw new PenaltyError('Penalty was created but could not be loaded.');
  return created;
}

export async function cancelPenalty(
  ctx: RequestContext,
  id: string,
  body: CancelPenaltyBody,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ employeeId: string; status: string }>(sql`
      SELECT employee_id AS "employeeId", status FROM employee_penalty
      WHERE organization_id = ${ctx.organizationId} AND id = ${id} FOR UPDATE
    `);
    if (!current) throw new PenaltyError('Penalty not found.');
    if (current.status !== 'active')
      throw new PenaltyError('Only an active penalty can be cancelled.');
    if (
      !(await repo.cancelPenalty(
        tx,
        ctx.organizationId,
        id,
        body.cancellationReason,
        ctx.principal.id,
      ))
    )
      throw new PenaltyError('Penalty could not be cancelled.');
    await writePenaltyAudit(
      tx,
      ctx,
      'penalty.cancelled',
      id,
      {
        status: 'cancelled',
        cancellationReason: body.cancellationReason,
        cancelledBy: ctx.principal.id,
      },
      { status: 'active', employeeId: current.employeeId },
      body.cancellationReason,
    );
  });
}
