import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { PenaltyRow, PenaltySummary } from './types.js';
import type { CreatePenaltyBody, ListPenaltyQuery } from './validators.js';

export const penaltySelect = sql.raw(`
  SELECT p.id, p.organization_id AS "organizationId", p.employee_id AS "employeeId",
    u.employee_id AS "employeeCode", u.full_name AS "employeeName",
    d.name AS "departmentName", t.name AS "teamName", pos.name AS "positionName",
    p.penalty_type AS "penaltyType", p.amount_paise::text AS "amountPaise",
    p.penalty_date::text AS "penaltyDate", p.payroll_period::text AS "payrollPeriod",
    p.remarks, p.status, p.payroll_status AS "payrollStatus",
    p.cancellation_reason AS "cancellationReason", p.cancelled_at::text AS "cancelledAt",
    p.created_at::text AS "createdAt", p.created_by AS "createdBy"
  FROM employee_penalty p
  JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.employee_id
  LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
  LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
  LEFT JOIN position pos ON pos.organization_id = u.organization_id AND pos.id = u.position_id`);

function filters(query: ListPenaltyQuery): ReturnType<typeof sql>[] {
  const parts: ReturnType<typeof sql>[] = [
    sql`p.organization_id = current_organization_id()`,
  ];
  if (query.search)
    parts.push(
      sql`(u.full_name ILIKE ${`%${query.search}%`} OR u.employee_id ILIKE ${`%${query.search}%`})`,
    );
  if (query.penaltyType) parts.push(sql`p.penalty_type = ${query.penaltyType}`);
  if (query.status !== 'all') parts.push(sql`p.status = ${query.status}`);
  if (query.payrollStatus !== 'all')
    parts.push(sql`p.payroll_status = ${query.payrollStatus}`);
  if (query.payrollPeriod)
    parts.push(sql`p.payroll_period = ${query.payrollPeriod}::date`);
  if (query.dateFrom) parts.push(sql`p.penalty_date >= ${query.dateFrom}::date`);
  if (query.dateTo) parts.push(sql`p.penalty_date <= ${query.dateTo}::date`);
  return parts;
}

export async function listPenalties(
  ctx: RequestContext,
  query: ListPenaltyQuery,
  visibility: ReturnType<typeof sql>,
): Promise<{ rows: PenaltyRow[]; total: number; page: number; pageSize: number; totalPages: number; summary: PenaltySummary }> {
  return db.transaction(ctx, async (tx) => {
    const where = sql.join([...filters(query), visibility], ' AND ');
    const count = await tx.one<{ total: ReturnType<typeof Number> }>(sql`
      SELECT count(*)::int AS total
      FROM employee_penalty p JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.employee_id
      WHERE ${where}
    `);
    const summary = await tx.one<{ activeCount: number; activeAmountPaise: string; pendingAmountPaise: string }>(sql`
      SELECT count(*) FILTER (WHERE p.status = 'active')::int AS "activeCount",
        COALESCE(SUM(p.amount_paise) FILTER (WHERE p.status = 'active'), 0)::text AS "activeAmountPaise",
        COALESCE(SUM(p.amount_paise) FILTER (WHERE p.status = 'active' AND p.payroll_status = 'pending'), 0)::text AS "pendingAmountPaise"
      FROM employee_penalty p JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.employee_id
      WHERE ${where}
    `);
    const rows = await tx.query<PenaltyRow>(sql`
      ${penaltySelect}
      WHERE ${where}
      ORDER BY p.penalty_date DESC, p.created_at DESC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
    `);
    return {
      rows,
      total: count.total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(count.total / query.pageSize)),
      summary,
    };
  });
}

export async function exportPenalties(
  ctx: RequestContext,
  query: ListPenaltyQuery,
  visibility: ReturnType<typeof sql>,
): Promise<PenaltyRow[]> {
  return db.transaction(ctx, async (tx) => {
    const where = sql.join([...filters(query), visibility], ' AND ');
    return tx.query<PenaltyRow>(sql`
      ${penaltySelect}
      WHERE ${where}
      ORDER BY p.penalty_date DESC, p.created_at DESC
    `);
  });
}

export async function findPenalty(
  ctx: RequestContext,
  id: string,
): Promise<PenaltyRow | null> {
  return db.maybeOne<PenaltyRow>(
    ctx,
    sql`${penaltySelect} WHERE p.organization_id = ${ctx.organizationId} AND p.id = ${id}`,
  );
}

export async function employeeExists(
  tx: Tx,
  organizationId: string,
  employeeId: string,
): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM app_user
    WHERE organization_id = ${organizationId} AND id = ${employeeId}::uuid
      AND account_type = 'employee' AND status = 'active'
  `);
  return row !== null;
}

export async function insertPenalty(
  tx: Tx,
  organizationId: string,
  body: CreatePenaltyBody,
  createdBy: string,
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO employee_penalty
      (organization_id, employee_id, penalty_type, amount_paise, penalty_date, payroll_period, remarks, created_by)
    VALUES (${organizationId}, ${body.employeeId}::uuid, ${body.penaltyType}, ${body.amountPaise}, ${body.penaltyDate}::date, ${body.payrollPeriod}::date, ${body.remarks}, ${createdBy}::uuid)
    RETURNING id
  `);
  return row.id;
}

export async function cancelPenalty(
  tx: Tx,
  organizationId: string,
  id: string,
  reason: string,
  cancelledBy: string,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE employee_penalty
    SET status = 'cancelled', cancellation_reason = ${reason}, cancelled_at = now(), cancelled_by = ${cancelledBy}::uuid, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'active'
    RETURNING id
  `);
  return rows.length > 0;
}
