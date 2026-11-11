import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { postSourceJournalTx } from '../accounting/facade.js';
import { PayablesError } from './errors.js';
import { storeBillArtifact, readBillArtifact, removeBillArtifact } from './file-store.js';
import { paginate, type PaginationInput } from '../pagination.js';
import type {
  BankChangeInput,
  BillDecisionInput,
  BillInput,
  PaymentRunDecisionInput,
  PaymentRunInput,
  PurchaseRequestInput,
  PurchaseRequestDecisionInput,
  PurchaseRequestMatchInput,
  ReimbursementInput,
  SubscriptionInput,
  VendorInput,
} from './validators.js';

function cents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
async function audit(
  ctx: RequestContext,
  tx: Tx,
  action: string,
  targetId: string,
  reason: string,
  after: unknown,
) {
  await tx.query(
    sql`INSERT INTO audit_outbox (organization_id,stream,payload) VALUES (${ctx.organizationId},'activity',${JSON.stringify({ action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'payables', targetId, reason, after, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`,
  );
}

export const listVendors = (ctx: RequestContext, page: PaginationInput) =>
  paginate(
    ctx,
    sql`SELECT id,legal_name AS "legalName",display_name AS "displayName",email::text,phone,gstin,pan,currency,payment_terms_days AS "paymentTermsDays",status,created_at AS "createdAt" FROM finance_vendor WHERE organization_id=${ctx.organizationId} ORDER BY display_name LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_vendor WHERE organization_id=${ctx.organizationId}`,
    page,
  );
export const listBankChanges = (ctx: RequestContext, page: PaginationInput) =>
  paginate(
    ctx,
    sql`SELECT b.id,b.vendor_id AS "vendorId",v.display_name AS "vendorName",b.bank_name AS "bankName",CASE WHEN length(b.account_reference) > 4 THEN repeat('•', length(b.account_reference) - 4) || right(b.account_reference, 4) ELSE b.account_reference END AS "accountReference",b.ifsc,b.status,b.proposed_by AS "proposedBy",b.approved_by AS "approvedBy",b.reason,b.created_at AS "createdAt" FROM finance_vendor_bank_account b JOIN finance_vendor v ON v.organization_id=b.organization_id AND v.id=b.vendor_id WHERE b.organization_id=${ctx.organizationId} ORDER BY b.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_vendor_bank_account WHERE organization_id=${ctx.organizationId}`,
    page,
  );
export const listBills = (ctx: RequestContext, page: PaginationInput) =>
  paginate(
    ctx,
    sql`SELECT b.id,b.vendor_id AS "vendorId",v.display_name AS "vendorName",b.source_type AS "sourceType",b.source_id AS "sourceId",b.invoice_number AS "invoiceNumber",b.issue_date AS "issueDate",b.due_date AS "dueDate",b.currency,b.subtotal::text,b.tax_total::text AS "taxTotal",b.total::text,b.tds_section AS "tdsSection",b.tds_rate::text AS "tdsRate",b.rcm,b.extraction_status AS "extractionStatus",b.status,b.artifact_filename AS "artifactFilename",b.journal_id AS "journalId",b.created_at AS "createdAt" FROM finance_payable_bill b LEFT JOIN finance_vendor v ON v.organization_id=b.organization_id AND v.id=b.vendor_id WHERE b.organization_id=${ctx.organizationId} ORDER BY b.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_payable_bill WHERE organization_id=${ctx.organizationId}`,
    page,
  );
export const listRuns = (ctx: RequestContext, page: PaginationInput) =>
  paginate(
    ctx,
    sql`SELECT id,manifest_sha256 AS "manifestSha256",currency,total::text,status,created_by AS "createdBy",approved_by AS "approvedBy",executed_by AS "executedBy",journal_id AS "journalId",created_at AS "createdAt" FROM finance_payment_run WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_payment_run WHERE organization_id=${ctx.organizationId}`,
    page,
  );
export const listSubscriptions = (ctx: RequestContext, page: PaginationInput) =>
  paginate(
    ctx,
    sql`SELECT s.id,s.vendor_id AS "vendorId",v.display_name AS "vendorName",s.name,s.amount::text,s.currency,s.recurrence,s.next_due_date AS "nextDueDate",s.status,s.reason FROM finance_payable_subscription s JOIN finance_vendor v ON v.organization_id=s.organization_id AND v.id=s.vendor_id WHERE s.organization_id=${ctx.organizationId} ORDER BY s.next_due_date LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_payable_subscription WHERE organization_id=${ctx.organizationId}`,
    page,
  );
export const listPurchaseRequests = (ctx: RequestContext, page: PaginationInput) =>
  paginate(
    ctx,
    sql`SELECT p.id,p.vendor_id AS "vendorId",p.description,p.amount::text,p.currency,p.status,p.reason,p.requester_id AS "requesterId",p.approved_by AS "approvedBy",p.matched_bill_id AS "matchedBillId",p.created_at AS "createdAt" FROM finance_purchase_request p WHERE p.organization_id=${ctx.organizationId} ORDER BY p.created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_purchase_request WHERE organization_id=${ctx.organizationId}`,
    page,
  );

export async function listReimbursementClaims(ctx: RequestContext) {
  return db.query<{
    id: string;
    employeeName: string;
    expenseDate: string;
    amount: string;
    currency: string;
  }>(
    ctx,
    sql`
    SELECT c.id, u.full_name AS "employeeName", c.expense_date::text AS "expenseDate",
      (c.amount_paise / 100.0)::numeric(18,2)::text AS amount, c.currency
    FROM expense_claim c
    JOIN app_user u ON u.organization_id=c.organization_id AND u.id=c.claimed_by
    WHERE c.organization_id=${ctx.organizationId} AND c.status='approved'
      AND NOT EXISTS (
        SELECT 1 FROM finance_payable_bill b
        WHERE b.organization_id=c.organization_id AND b.source_type='expense_claim' AND b.source_id=c.id
      )
    ORDER BY c.expense_date DESC, c.created_at DESC LIMIT 100
  `,
  );
}

export async function listPaymentRunCandidates(ctx: RequestContext) {
  return db.query<{
    id: string;
    invoiceNumber: string;
    vendorName: string;
    currency: string;
    total: string;
    dueDate: string;
  }>(
    ctx,
    sql`
    SELECT b.id, b.invoice_number AS "invoiceNumber", COALESCE(v.display_name, 'Employee reimbursement') AS "vendorName",
      b.currency, b.total::text, b.due_date::text AS "dueDate"
    FROM finance_payable_bill b
    LEFT JOIN finance_vendor v ON v.organization_id=b.organization_id AND v.id=b.vendor_id
    WHERE b.organization_id=${ctx.organizationId} AND b.status='approved'
      AND NOT EXISTS (
        SELECT 1 FROM finance_payment_run_item i
        JOIN finance_payment_run r ON r.organization_id=i.organization_id AND r.id=i.run_id
        WHERE i.organization_id=b.organization_id AND i.bill_id=b.id AND r.status IN ('proposed','approved')
      )
    ORDER BY b.due_date, b.created_at LIMIT 500
  `,
  );
}

export async function createVendor(ctx: RequestContext, input: VendorInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_vendor (organization_id,legal_name,display_name,email,phone,gstin,pan,currency,payment_terms_days,created_by) VALUES (${ctx.organizationId},${input.legalName},${input.displayName},${input.email ?? null},${input.phone ?? null},${input.gstin ?? null},${input.pan ?? null},${input.currency},${input.paymentTermsDays},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'payables.vendor.created', row.id, 'Vendor created.', input);
    return row;
  });
}
export async function proposeBankChange(
  ctx: RequestContext,
  vendorId: string,
  input: BankChangeInput,
) {
  return db.transaction(ctx, async (tx) => {
    const vendor = await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM finance_vendor WHERE organization_id=${ctx.organizationId} AND id=${vendorId} AND status='active'`,
    );
    if (!vendor) throw new PayablesError('Active vendor not found.', 404);
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_vendor_bank_account (organization_id,vendor_id,bank_name,account_reference,ifsc,reason,proposed_by) VALUES (${ctx.organizationId},${vendorId},${input.bankName},${input.accountReference},${input.ifsc ?? null},${input.reason},${ctx.principal.id}) RETURNING id`,
    );
    await audit(
      ctx,
      tx,
      'payables.vendor.bank_change.proposed',
      row.id,
      input.reason,
      input,
    );
    return row;
  });
}
export async function approveBankChange(
  ctx: RequestContext,
  id: string,
  input: BillDecisionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ proposedBy: string }>(
      sql`SELECT proposed_by AS "proposedBy" FROM finance_vendor_bank_account WHERE organization_id=${ctx.organizationId} AND id=${id} AND status='pending' FOR UPDATE`,
    );
    if (row.proposedBy === ctx.principal.id)
      throw new PayablesError('The bank-change proposer cannot approve the same change.');
    await tx.query(
      sql`UPDATE finance_vendor_bank_account SET status='approved',approved_by=${ctx.principal.id},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id}`,
    );
    await audit(ctx, tx, 'payables.vendor.bank_change.approved', id, input.reason, {
      status: 'approved',
    });
    return { id, status: 'approved' };
  });
}

export async function createBill(ctx: RequestContext, input: BillInput) {
  const id = randomUUID();
  let stored: {
    relativePath: string;
    sizeBytes: number;
    sha256: string;
    mimeType: string;
  } | null = null;
  try {
    if (input.artifact)
      stored = await storeBillArtifact(
        ctx.organizationId,
        id,
        input.artifact.originalFilename,
        input.artifact.mimeType,
        input.artifact.data,
      );
    return await db.transaction(ctx, async (tx) => {
      if (cents(input.subtotal) + cents(input.taxTotal) !== cents(input.total))
        throw new PayablesError('Bill total must equal subtotal plus tax.');
      if (input.rcm && cents(input.taxTotal) === 0n)
        throw new PayablesError(
          'RCM bills must include a tax amount for self-assessment.',
        );
      if (input.tdsRate > 0 && !input.tdsSection)
        throw new PayablesError('A TDS section is required when a TDS rate is supplied.');
      if (input.dueDate < input.issueDate)
        throw new PayablesError('Bill due date cannot be before its issue date.');
      if (input.vendorId) {
        const vendor = await tx.maybeOne<{ currency: string }>(
          sql`SELECT currency FROM finance_vendor WHERE organization_id=${ctx.organizationId} AND id=${input.vendorId} AND status='active'`,
        );
        if (!vendor) throw new PayablesError('Active vendor not found.', 404);
        if (vendor.currency !== input.currency)
          throw new PayablesError('Bill currency must match the vendor currency.');
      }
      const duplicate = await tx.maybeOne<{ id: string }>(
        sql`SELECT id FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND vendor_id IS NOT DISTINCT FROM ${input.vendorId ?? null} AND invoice_number=${input.invoiceNumber}`,
      );
      if (duplicate)
        throw new PayablesError(
          'A bill with this vendor and invoice number already exists.',
          409,
          'PAYABLES_DUPLICATE_BILL',
        );
      if (stored) {
        const artifactDuplicate = await tx.maybeOne<{ id: string }>(
          sql`SELECT id FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND artifact_sha256=${stored.sha256}`,
        );
        if (artifactDuplicate)
          throw new PayablesError(
            'This bill artifact has already been uploaded.',
            409,
            'PAYABLES_DUPLICATE_ARTIFACT',
          );
      }
      const extractionStatus =
        input.extractionStatus === 'manual' ? 'manual' : 'needs_review';
      const row = await tx.one<{ id: string }>(
        sql`INSERT INTO finance_payable_bill (id,organization_id,vendor_id,source_type,invoice_number,issue_date,due_date,currency,subtotal,tax_total,total,gstin,tds_section,tds_rate,rcm,extraction_status,status,duplicate_key,artifact_filename,artifact_relative_path,artifact_mime_type,artifact_sha256,created_by) VALUES (${id},${ctx.organizationId},${input.vendorId ?? null},'manual',${input.invoiceNumber},${input.issueDate},${input.dueDate},${input.currency},${input.subtotal},${input.taxTotal},${input.total},${input.gstin ?? null},${input.tdsSection ?? null},${input.tdsRate},${input.rcm},${extractionStatus},'needs_review',${`${input.vendorId ?? 'unknown'}:${input.invoiceNumber}`},${input.artifact?.originalFilename ?? null},${stored?.relativePath ?? null},${stored?.mimeType ?? null},${stored?.sha256 ?? null},${ctx.principal.id}) RETURNING id`,
      );
      await audit(ctx, tx, 'payables.bill.created', row.id, input.reason, {
        status: 'needs_review',
        extractionStatus: input.extractionStatus,
      });
      return row;
    });
  } catch (error) {
    if (stored) await removeBillArtifact(stored.relativePath);
    throw error;
  }
}

export async function createExpenseReimbursement(
  ctx: RequestContext,
  input: ReimbursementInput,
) {
  return db.transaction(ctx, async (tx) => {
    const claim = await tx.maybeOne<{
      id: string;
      amountPaise: string;
      expenseDate: string;
      currency: string;
      claimedBy: string;
    }>(
      sql`SELECT id,amount_paise::text AS "amountPaise",expense_date AS "expenseDate",currency,claimed_by AS "claimedBy" FROM expense_claim WHERE organization_id=${ctx.organizationId} AND id=${input.claimId} AND status='approved' FOR SHARE`,
    );
    if (!claim)
      throw new PayablesError(
        'Only an approved employee expense claim can become a reimbursement.',
        422,
      );
    const existing = await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND source_type='expense_claim' AND source_id=${input.claimId}`,
    );
    if (existing) return existing;
    const total = money(BigInt(claim.amountPaise));
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_payable_bill (organization_id,source_type,source_id,invoice_number,issue_date,due_date,currency,subtotal,total,extraction_status,status,duplicate_key,created_by) VALUES (${ctx.organizationId},'expense_claim',${input.claimId},${`EXP-${input.claimId.slice(0, 12)}`},${claim.expenseDate},CURRENT_DATE + 7,${claim.currency},${total},${total},'confirmed','needs_review',${`expense_claim:${input.claimId}`},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'payables.reimbursement.created', row.id, input.reason, {
      claimId: input.claimId,
      employeeId: claim.claimedBy,
    });
    return row;
  });
}

export async function confirmBillExtraction(
  ctx: RequestContext,
  billId: string,
  reason: string,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string; extractionStatus: string }>(
      sql`SELECT status,extraction_status AS "extractionStatus" FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND id=${billId} FOR UPDATE`,
    );
    if (row.status !== 'needs_review' || row.extractionStatus !== 'needs_review')
      throw new PayablesError('Only an extracted bill needing review can be confirmed.');
    await tx.query(
      sql`UPDATE finance_payable_bill SET extraction_status='confirmed',updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${billId}`,
    );
    await audit(ctx, tx, 'payables.bill.extraction.confirmed', billId, reason, {
      extractionStatus: 'confirmed',
    });
    return { id: billId, extractionStatus: 'confirmed' };
  });
}

export async function approveBill(
  ctx: RequestContext,
  billId: string,
  input: BillDecisionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const bill = await tx.one<{
      vendorId: string | null;
      subtotal: string;
      taxTotal: string;
      total: string;
      tdsRate: string;
      rcm: boolean;
      status: string;
      extractionStatus: string;
      sourceType: string;
    }>(
      sql`SELECT vendor_id AS "vendorId",subtotal::text,tax_total::text AS "taxTotal",total::text,tds_rate::text AS "tdsRate",rcm,status,extraction_status AS "extractionStatus",source_type AS "sourceType" FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND id=${billId} FOR UPDATE`,
    );
    if (bill.status !== 'needs_review' && bill.status !== 'draft')
      throw new PayablesError('Only bills needing review can be approved.');
    if (bill.extractionStatus === 'needs_review')
      throw new PayablesError('Bill extraction needs human review before approval.');
    const total = cents(bill.total);
    const tds = (total * BigInt(Math.round(Number(bill.tdsRate) * 100))) / 10000n;
    const tax = cents(bill.taxTotal);
    const net = total - tds;
    const payableAmount = bill.rcm ? total - tax - tds : net;
    const lines: Array<{
      accountKey: string;
      amountPaise: bigint;
      side: 'debit' | 'credit';
    }> = [
      {
        accountKey: 'general-expense',
        amountPaise: cents(bill.subtotal),
        side: 'debit' as const,
      },
    ];
    if (cents(bill.taxTotal) > 0n)
      lines.push({
        accountKey: 'input-gst',
        amountPaise: cents(bill.taxTotal),
        side: 'debit' as const,
      });
    lines.push({
      accountKey: 'accounts-payable',
      amountPaise: payableAmount,
      side: 'credit' as const,
    });
    if (bill.rcm)
      lines.push({
        accountKey: 'gst-payable',
        amountPaise: tax,
        side: 'credit' as const,
      });
    if (tds > 0n)
      lines.push({
        accountKey: 'tds-payable',
        amountPaise: tds,
        side: 'credit' as const,
      });
    const journal = await postSourceJournalTx(tx, {
      organizationId: ctx.organizationId,
      postedBy: ctx.principal.id,
      entryDate: new Date().toISOString().slice(0, 10),
      sourceType: 'payable_bill',
      sourceId: billId,
      description: `Payable bill ${billId}`,
      reason: input.reason,
      lines,
    });
    await tx.query(
      sql`UPDATE finance_payable_bill SET status='approved',approved_by=${ctx.principal.id},approved_at=now(),journal_id=${journal.journalId},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${billId}`,
    );
    await audit(ctx, tx, 'payables.bill.approved', billId, input.reason, {
      journalId: journal.journalId,
    });
    return { id: billId, journalId: journal.journalId };
  });
}

export async function createSubscription(ctx: RequestContext, input: SubscriptionInput) {
  return db.transaction(ctx, async (tx) => {
    const vendor = await tx.maybeOne<{ currency: string }>(
      sql`SELECT currency FROM finance_vendor WHERE organization_id=${ctx.organizationId} AND id=${input.vendorId} AND status='active'`,
    );
    if (!vendor) throw new PayablesError('Active vendor not found.', 404);
    if (vendor.currency !== input.currency)
      throw new PayablesError('Subscription currency must match the vendor currency.');
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_payable_subscription (organization_id,vendor_id,name,amount,currency,recurrence,next_due_date,owner_id,reason,created_by) VALUES (${ctx.organizationId},${input.vendorId},${input.name},${input.amount},${input.currency},${input.recurrence},${input.nextDueDate},${input.ownerId ?? null},${input.reason},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'payables.subscription.created', row.id, input.reason, input);
    return row;
  });
}
export async function createPurchaseRequest(
  ctx: RequestContext,
  input: PurchaseRequestInput,
) {
  return db.transaction(ctx, async (tx) => {
    if (input.vendorId) {
      const vendor = await tx.maybeOne<{ currency: string }>(
        sql`SELECT currency FROM finance_vendor WHERE organization_id=${ctx.organizationId} AND id=${input.vendorId} AND status='active'`,
      );
      if (!vendor) throw new PayablesError('Active vendor not found.', 404);
      if (vendor.currency !== input.currency)
        throw new PayablesError(
          'Purchase-request currency must match the vendor currency.',
        );
    }
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_purchase_request (organization_id,vendor_id,requester_id,description,amount,currency,reason) VALUES (${ctx.organizationId},${input.vendorId ?? null},${ctx.principal.id},${input.description},${input.amount},${input.currency},${input.reason}) RETURNING id`,
    );
    await audit(
      ctx,
      tx,
      'payables.purchase_request.created',
      row.id,
      input.reason,
      input,
    );
    return row;
  });
}

export async function approvePurchaseRequest(
  ctx: RequestContext,
  requestId: string,
  input: PurchaseRequestDecisionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string; requesterId: string }>(
      sql`SELECT status,requester_id AS "requesterId" FROM finance_purchase_request WHERE organization_id=${ctx.organizationId} AND id=${requestId} FOR UPDATE`,
    );
    if (row.status !== 'pending')
      throw new PayablesError('Only pending purchase requests can be approved.');
    if (row.requesterId === ctx.principal.id)
      throw new PayablesError(
        'The purchase-request requester cannot approve the same request.',
      );
    await tx.query(
      sql`UPDATE finance_purchase_request SET status='approved',approved_by=${ctx.principal.id},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${requestId}`,
    );
    await audit(ctx, tx, 'payables.purchase_request.approved', requestId, input.reason, {
      status: 'approved',
    });
    return { id: requestId, status: 'approved' };
  });
}

export async function matchPurchaseRequest(
  ctx: RequestContext,
  requestId: string,
  input: PurchaseRequestMatchInput,
) {
  return db.transaction(ctx, async (tx) => {
    const request = await tx.one<{
      status: string;
      vendorId: string | null;
      amount: string;
      currency: string;
    }>(
      sql`SELECT status,vendor_id AS "vendorId",amount::text,currency FROM finance_purchase_request WHERE organization_id=${ctx.organizationId} AND id=${requestId} FOR UPDATE`,
    );
    const bill = await tx.one<{
      status: string;
      vendorId: string | null;
      total: string;
      currency: string;
    }>(
      sql`SELECT status,vendor_id AS "vendorId",total::text,currency FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND id=${input.billId} FOR SHARE`,
    );
    if (request.status !== 'approved')
      throw new PayablesError('Only approved purchase requests can be matched.');
    if (bill.status === 'rejected' || bill.status === 'paid')
      throw new PayablesError('The bill is not eligible for purchase matching.');
    if (
      request.vendorId !== bill.vendorId ||
      request.currency !== bill.currency ||
      cents(bill.total) < cents(request.amount)
    )
      throw new PayablesError(
        'Bill vendor, currency, and value must satisfy the purchase request.',
      );
    await tx.query(
      sql`UPDATE finance_purchase_request SET status='matched',matched_bill_id=${input.billId},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${requestId}`,
    );
    await audit(ctx, tx, 'payables.purchase_request.matched', requestId, input.reason, {
      billId: input.billId,
    });
    return { id: requestId, status: 'matched', billId: input.billId };
  });
}

export async function createPaymentRun(
  ctx: RequestContext,
  input: PaymentRunInput & { reason: string },
) {
  return db.transaction(ctx, async (tx) => {
    const bills = await tx.query<{ id: string; total: string }>(
      sql`SELECT id,total::text FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND id=ANY(${input.billIds}::uuid[]) AND currency=${input.currency} AND status='approved' FOR SHARE`,
    );
    if (bills.length !== input.billIds.length)
      throw new PayablesError(
        'Every selected bill must be approved, unpaid, and use the same currency.',
      );
    const alreadyIncluded = await tx.query<{ billId: string }>(sql`
      SELECT i.bill_id AS "billId"
      FROM finance_payment_run_item i
      JOIN finance_payment_run r ON r.organization_id=i.organization_id AND r.id=i.run_id
      WHERE i.organization_id=${ctx.organizationId} AND i.bill_id=ANY(${input.billIds}::uuid[])
        AND r.status IN ('proposed','approved')
    `);
    if (alreadyIncluded.length > 0)
      throw new PayablesError(
        'One or more selected bills are already included in an active payment run. Refresh the candidates and try again.',
      );
    const total = bills.reduce((sum, bill) => sum + cents(bill.total), 0n);
    const manifest = {
      bills: bills.map((bill) => ({ id: bill.id, amount: bill.total })),
      currency: input.currency,
    };
    const hash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const run = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_payment_run (organization_id,manifest,manifest_sha256,currency,total,created_by) VALUES (${ctx.organizationId},${JSON.stringify(manifest)}::jsonb,${hash},${input.currency},${money(total)},${ctx.principal.id}) RETURNING id`,
    );
    for (const bill of bills)
      await tx.query(
        sql`INSERT INTO finance_payment_run_item (organization_id,run_id,bill_id,amount) VALUES (${ctx.organizationId},${run.id},${bill.id},${bill.total})`,
      );
    await audit(ctx, tx, 'payables.payment_run.proposed', run.id, input.reason, manifest);
    return run;
  });
}
export async function approvePaymentRun(
  ctx: RequestContext,
  runId: string,
  input: PaymentRunDecisionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string; createdBy: string }>(
      sql`SELECT status,created_by AS "createdBy" FROM finance_payment_run WHERE organization_id=${ctx.organizationId} AND id=${runId} FOR UPDATE`,
    );
    if (row.status !== 'proposed')
      throw new PayablesError('Only proposed payment runs can be approved.');
    if (row.createdBy === ctx.principal.id)
      throw new PayablesError('The payment-run proposer cannot approve the same run.');
    await tx.query(
      sql`UPDATE finance_payment_run SET status='approved',approved_by=${ctx.principal.id},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${runId}`,
    );
    await audit(ctx, tx, 'payables.payment_run.approved', runId, input.reason, {
      status: 'approved',
    });
    return { id: runId, status: 'approved' };
  });
}
export async function executePaymentRun(
  ctx: RequestContext,
  runId: string,
  input: PaymentRunDecisionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const run = await tx.one<{ total: string; status: string }>(
      sql`SELECT total::text,status FROM finance_payment_run WHERE organization_id=${ctx.organizationId} AND id=${runId} FOR UPDATE`,
    );
    if (run.status !== 'approved')
      throw new PayablesError('Only approved payment runs can be executed.');
    const billStates = await tx.query<{ status: string }>(
      sql`SELECT b.status FROM finance_payment_run_item i JOIN finance_payable_bill b ON b.organization_id=i.organization_id AND b.id=i.bill_id WHERE i.organization_id=${ctx.organizationId} AND i.run_id=${runId} FOR UPDATE`,
    );
    if (billStates.length === 0 || billStates.some((bill) => bill.status !== 'approved'))
      throw new PayablesError(
        'Every bill in the payment run must still be approved and unpaid.',
      );
    const total = cents(run.total);
    const journal = await postSourceJournalTx(tx, {
      organizationId: ctx.organizationId,
      postedBy: ctx.principal.id,
      entryDate: new Date().toISOString().slice(0, 10),
      sourceType: 'payable_payment_run',
      sourceId: runId,
      description: `Payables payment run ${runId}`,
      reason: input.reason,
      lines: [
        { accountKey: 'accounts-payable', amountPaise: total, side: 'debit' },
        { accountKey: 'bank', amountPaise: total, side: 'credit' },
      ],
    });
    await tx.query(
      sql`UPDATE finance_payable_bill b SET status='paid',updated_at=now() FROM finance_payment_run_item i WHERE i.organization_id=${ctx.organizationId} AND i.run_id=${runId} AND i.bill_id=b.id`,
    );
    await tx.query(
      sql`UPDATE finance_payment_run SET status='executed',executed_by=${ctx.principal.id},journal_id=${journal.journalId},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${runId}`,
    );
    await audit(ctx, tx, 'payables.payment_run.executed', runId, input.reason, {
      journalId: journal.journalId,
    });
    return { id: runId, journalId: journal.journalId };
  });
}

export async function downloadBillArtifact(ctx: RequestContext, billId: string) {
  const row = await db.maybeOne<{
    relativePath: string;
    filename: string;
    mimeType: string;
  }>(
    ctx,
    sql`SELECT artifact_relative_path AS "relativePath",artifact_filename AS filename,artifact_mime_type AS "mimeType" FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND id=${billId} AND artifact_relative_path IS NOT NULL`,
  );
  if (!row) throw new PayablesError('Bill artifact not found.', 404);
  return { ...row, body: await readBillArtifact(row.relativePath) };
}
