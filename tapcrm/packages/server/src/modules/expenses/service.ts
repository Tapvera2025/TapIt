import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { notify, NOTIFICATION_TYPES } from '../notifications/facade.js';
import { ExpenseError } from './errors.js';
import * as repo from './repository.js';
import { removeReceipt, storeReceipt, readReceipt } from './file-store.js';
import { writeExpenseAudit } from './audit.js';
import type { ExpenseClaimRow } from './types.js';
import type { CreateExpenseBody, ExpenseListQuery, RejectExpenseBody, UpdateExpenseBody } from './validators.js';

export async function listMine(ctx: RequestContext, query: ExpenseListQuery) {
  return repo.listClaims(ctx, query, sql`c.claimed_by=${ctx.principal.id}`);
}
export async function listApprovals(ctx: RequestContext, query: ExpenseListQuery) {
  return repo.listClaims(ctx, query, await visibilityFilter(ctx, 'payables:approve-claim', 'expenseClaim'));
}
export async function getClaim(ctx: RequestContext, id: string): Promise<ExpenseClaimRow> {
  const row = await repo.findClaim(ctx, id);
  if (!row) throw new ExpenseError('Expense claim not found.');
  return row;
}

export async function createClaim(ctx: RequestContext, body: CreateExpenseBody): Promise<ExpenseClaimRow> {
  let createdId = '';
  const stored: Array<{ relativePath: string }> = [];
  try {
    createdId = await db.transaction(ctx, async (tx) => {
      const id = await repo.insertClaim(tx, ctx.organizationId, ctx.principal.id, body);
      await writeExpenseAudit(tx, ctx, 'expense.claim.created', id, { expenseDate: body.expenseDate, amountPaise: body.amountPaise, category: body.category });
      for (const file of body.attachments) {
        const saved = await storeReceipt(ctx.organizationId, id, file.originalFilename, file.mimeType, file.data);
        stored.push(saved);
        const attachmentId = await repo.addAttachment(tx, ctx.organizationId, id, ctx.principal.id, { ...saved, originalFilename: file.originalFilename });
        await writeExpenseAudit(tx, ctx, 'expense.claim.attachment.added', id, { attachmentId, originalFilename: file.originalFilename });
      }
      await notify(tx, ctx, { type: NOTIFICATION_TYPES.EXPENSE_CLAIM_SUBMITTED, priority: 'operational', audience: { holders: { action: 'payables:approve-claim' }, excludeUserIds: [ctx.principal.id] }, title: 'New expense claim', body: 'An employee expense claim is waiting for review.', link: '/company/expenses/approvals', metadata: { claimId: id } });
      return id;
    });
  } catch (error) {
    await Promise.all(stored.map((file) => removeReceipt(file.relativePath)));
    throw error;
  }
  return getClaim(ctx, createdId);
}

export async function updateClaim(ctx: RequestContext, id: string, body: UpdateExpenseBody): Promise<ExpenseClaimRow> {
  await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ claimedBy: string; status: string }>(sql`SELECT claimed_by AS "claimedBy", status FROM expense_claim WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`);
    if (!current || current.claimedBy !== ctx.principal.id) throw new ExpenseError('Expense claim not found.');
    if (current.status !== 'pending') throw new ExpenseError('Only pending expense claims can be edited.');
    await repo.updateClaim(tx, ctx.organizationId, id, body);
    await writeExpenseAudit(tx, ctx, 'expense.claim.updated', id, { ...body });
  });
  return getClaim(ctx, id);
}

export async function deleteClaim(ctx: RequestContext, id: string): Promise<void> {
  let files: string[] = [];
  await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ claimedBy: string; status: string }>(sql`SELECT claimed_by AS "claimedBy", status FROM expense_claim WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`);
    if (!current || current.claimedBy !== ctx.principal.id) throw new ExpenseError('Expense claim not found.');
    if (current.status !== 'pending') throw new ExpenseError('Only pending expense claims can be deleted.');
    files = await repo.attachmentPaths(tx, ctx.organizationId, id);
    await tx.query(sql`DELETE FROM expense_claim WHERE organization_id=${ctx.organizationId} AND id=${id} AND status='pending'`);
    await writeExpenseAudit(tx, ctx, 'expense.claim.deleted', id, { status: 'deleted' });
  });
  await Promise.all(files.map((file) => removeReceipt(file)));
}

async function decide(ctx: RequestContext, id: string, status: 'approved' | 'rejected', reason: string | null): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ claimedBy: string; status: string }>(sql`SELECT claimed_by AS "claimedBy", status FROM expense_claim WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`);
    if (!current) throw new ExpenseError('Expense claim not found.');
    if (current.claimedBy === ctx.principal.id) throw new ExpenseError('You cannot review your own expense claim.');
    if (current.status !== 'pending') throw new ExpenseError('This expense has already been reviewed.');
    if (!(await repo.transitionClaim(tx, ctx.organizationId, id, status, ctx.principal.id, reason))) throw new ExpenseError('This expense has already been reviewed.');
    await writeExpenseAudit(tx, ctx, status === 'approved' ? 'expense.claim.approved' : 'expense.claim.rejected', id, { status, rejectionReason: reason, reviewedBy: ctx.principal.id }, { status: 'pending' });
    const claim = await tx.one<{ claimedBy: string }>(sql`SELECT claimed_by AS "claimedBy" FROM expense_claim WHERE organization_id=${ctx.organizationId} AND id=${id}`);
    await notify(tx, ctx, { type: status === 'approved' ? NOTIFICATION_TYPES.EXPENSE_CLAIM_APPROVED : NOTIFICATION_TYPES.EXPENSE_CLAIM_REJECTED, priority: status === 'rejected' ? 'operational' : 'informational', audience: { users: [claim.claimedBy] }, title: status === 'approved' ? 'Expense claim approved' : 'Expense claim rejected', body: status === 'approved' ? 'Your expense claim was approved.' : `Your expense claim was rejected: ${reason}`, link: '/company/expenses/mine', metadata: { claimId: id, status } });
  });
}
export const approveClaim = (ctx: RequestContext, id: string) => decide(ctx, id, 'approved', null);
export const rejectClaim = (ctx: RequestContext, id: string, body: RejectExpenseBody) => decide(ctx, id, 'rejected', body.rejectionReason);

export async function downloadAttachment(ctx: RequestContext, claimId: string, attachmentId: string) {
  const attachment = await repo.findAttachment(ctx, claimId, attachmentId);
  if (!attachment) throw new ExpenseError('Receipt not found.');
  return { ...attachment, body: await readReceipt(attachment.relativePath) };
}
