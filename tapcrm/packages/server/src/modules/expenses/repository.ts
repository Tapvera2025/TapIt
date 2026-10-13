import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { ExpenseClaimRow } from './types.js';
import type { CreateExpenseBody, ExpenseListQuery, UpdateExpenseBody } from './validators.js';

export const expenseSelect = sql.raw(`
 SELECT c.id, c.organization_id AS "organizationId", c.claimed_by AS "claimedBy",
   u.employee_id AS "employeeCode", u.full_name AS "employeeName", d.name AS "departmentName", p.name AS "positionName",
   c.expense_date::text AS "expenseDate", c.amount_paise::text AS "amountPaise", c.currency, c.category, c.remarks, c.status,
   c.rejection_reason AS "rejectionReason", c.reviewed_by AS "reviewedBy", rv.full_name AS "reviewerName",
   c.reviewed_at::text AS "reviewedAt", c.created_at::text AS "createdAt", c.updated_at::text AS "updatedAt"
 FROM expense_claim c JOIN app_user u ON u.organization_id=c.organization_id AND u.id=c.claimed_by
 LEFT JOIN department d ON d.organization_id=u.organization_id AND d.id=u.department_id
 LEFT JOIN position p ON p.organization_id=u.organization_id AND p.id=u.position_id
 LEFT JOIN app_user rv ON rv.organization_id=c.organization_id AND rv.id=c.reviewed_by`);

function filters(query: ExpenseListQuery, visibility: ReturnType<typeof sql>): ReturnType<typeof sql> {
  const parts = [sql`c.organization_id = current_organization_id()`, visibility];
  if (query.status !== 'all') parts.push(sql`c.status = ${query.status}`);
  if (query.category) parts.push(sql`c.category = ${query.category}`);
  if (query.search) parts.push(sql`(u.full_name ILIKE ${`%${query.search}%`} OR u.employee_id ILIKE ${`%${query.search}%`})`);
  if (query.dateFrom) parts.push(sql`c.expense_date >= ${query.dateFrom}::date`);
  if (query.dateTo) parts.push(sql`c.expense_date <= ${query.dateTo}::date`);
  return sql.join(parts, ' AND ');
}

async function addAttachments(ctx: RequestContext, rows: ExpenseClaimRow[]): Promise<ExpenseClaimRow[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((row) => row.id);
  const attachments = await db.query<ExpenseClaimRow['attachments'][number]>(ctx, sql`
    SELECT id, expense_claim_id AS "expenseClaimId", original_filename AS "originalFilename", mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at::text AS "createdAt"
    FROM expense_claim_attachment WHERE organization_id=${ctx.organizationId} AND expense_claim_id = ANY(${ids}::uuid[])
    ORDER BY created_at
  `);
  const byClaim = new Map<string, ExpenseClaimRow['attachments']>();
  for (const row of attachments) {
    const claimId = (row as unknown as { expenseClaimId?: string }).expenseClaimId;
    if (claimId) byClaim.set(claimId, [...(byClaim.get(claimId) ?? []), row]);
  }
  return rows.map((row) => ({ ...row, attachments: byClaim.get(row.id) ?? [] }));
}

export async function listClaims(ctx: RequestContext, query: ExpenseListQuery, visibility: ReturnType<typeof sql>) {
  return db.transaction(ctx, async (tx) => {
    const where = filters(query, visibility);
    const count = await tx.one<{ total: number; pending: number; approved: number; rejected: number }>(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE c.status='pending')::int AS pending,
        count(*) FILTER (WHERE c.status='approved')::int AS approved,
        count(*) FILTER (WHERE c.status='rejected')::int AS rejected
      FROM expense_claim c
      JOIN app_user u ON u.organization_id=c.organization_id AND u.id=c.claimed_by
      WHERE ${where}
    `);
    const rows = await tx.query<ExpenseClaimRow>(sql`${expenseSelect} WHERE ${where} ORDER BY c.created_at DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    return {
      rows: await addAttachments(ctx, rows),
      total: count.total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(count.total / query.pageSize)),
      summary: { totalCount: count.total, pendingCount: count.pending, approvedCount: count.approved, rejectedCount: count.rejected },
    };
  });
}

export async function findClaim(ctx: RequestContext, id: string): Promise<ExpenseClaimRow | null> {
  const row = await db.maybeOne<ExpenseClaimRow>(ctx, sql`${expenseSelect} WHERE c.organization_id=${ctx.organizationId} AND c.id=${id}`);
  return row ? (await addAttachments(ctx, [row]))[0]! : null;
}

export async function insertClaim(tx: Tx, organizationId: string, userId: string, body: CreateExpenseBody): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO expense_claim (organization_id, claimed_by, expense_date, amount_paise, category, remarks) VALUES (${organizationId}, ${userId}::uuid, ${body.expenseDate}::date, ${body.amountPaise}, ${body.category}, ${body.remarks}) RETURNING id`);
  return row.id;
}

export async function updateClaim(tx: Tx, organizationId: string, id: string, body: UpdateExpenseBody): Promise<void> {
  const fields = [
    body.expenseDate === undefined ? null : sql`expense_date=${body.expenseDate}::date`,
    body.amountPaise === undefined ? null : sql`amount_paise=${body.amountPaise}`,
    body.category === undefined ? null : sql`category=${body.category}`,
    body.remarks === undefined ? null : sql`remarks=${body.remarks}`,
  ].filter((field): field is ReturnType<typeof sql> => field !== null);
  await tx.query(sql`UPDATE expense_claim SET ${sql.join(fields, ', ')}, updated_at=now() WHERE organization_id=${organizationId} AND id=${id} AND status='pending'`);
}

export async function transitionClaim(tx: Tx, organizationId: string, id: string, status: 'approved' | 'rejected', reviewerId: string, rejectionReason: string | null): Promise<boolean> {
  const rows = await tx.query(sql`UPDATE expense_claim SET status=${status}, rejection_reason=${rejectionReason}, reviewed_by=${reviewerId}::uuid, reviewed_at=now(), updated_at=now() WHERE organization_id=${organizationId} AND id=${id} AND status='pending' RETURNING id`);
  return rows.length > 0;
}

export async function addAttachment(tx: Tx, organizationId: string, claimId: string, uploadedBy: string, file: { originalFilename: string; storedFilename: string; mimeType: string; sizeBytes: number; relativePath: string }): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`INSERT INTO expense_claim_attachment (organization_id, expense_claim_id, original_filename, stored_filename, mime_type, size_bytes, relative_path, uploaded_by) VALUES (${organizationId}, ${claimId}, ${file.originalFilename}, ${file.storedFilename}, ${file.mimeType}, ${file.sizeBytes}, ${file.relativePath}, ${uploadedBy}::uuid) RETURNING id`);
  return row.id;
}

export async function attachmentPaths(tx: Tx, organizationId: string, claimId: string): Promise<string[]> {
  const rows = await tx.query<{ relativePath: string }>(sql`
    SELECT relative_path AS "relativePath"
    FROM expense_claim_attachment
    WHERE organization_id=${organizationId} AND expense_claim_id=${claimId}
  `);
  return rows.map((row) => row.relativePath);
}

export async function findAttachment(ctx: RequestContext, claimId: string, attachmentId: string) {
  return db.maybeOne<{ id: string; originalFilename: string; mimeType: string; relativePath: string }>(ctx, sql`SELECT id, original_filename AS "originalFilename", mime_type AS "mimeType", relative_path AS "relativePath" FROM expense_claim_attachment WHERE organization_id=${ctx.organizationId} AND expense_claim_id=${claimId} AND id=${attachmentId}`);
}
