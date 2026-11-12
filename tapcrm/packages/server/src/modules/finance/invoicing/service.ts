import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../../../platform/dal/db.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { getFinanceFoundation } from '../foundation/service.js';
import { sql } from '../../../platform/dal/sql.js';
import { postSourceJournalTx } from '../accounting/facade.js';
import {
  InvoicingConflictError,
  InvoicingNotFoundError,
  InvoicingValidationError,
} from './errors.js';
import { fingerprint, token, tokenHash } from './fingerprint.js';
import { renderInvoicePdf } from './pdf.js';
import { readInvoicePdf, storeInvoicePdf } from './file-store.js';
import type { InvoiceDraft, IssuedInvoice } from './types.js';
import type {
  BatchConfirmInput,
  BatchReviewInput,
  ConfirmInput,
  DraftInput,
  ReviewInput,
} from './validators.js';

export async function listFormOptions(ctx: RequestContext) {
  await getFinanceFoundation(ctx);
  const [clients, entities, contracts, events, foundation] = await Promise.all([
    db.query(
      ctx,
      sql`SELECT c.id, c.organization_id AS "organizationId", c.client_name AS "clientName", c.business_name AS "businessName", c.email, c.region, c.currency, c.timezone, c.status, c.created_by AS "createdBy", c.created_at AS "createdAt", c.updated_at AS "updatedAt", (login.id IS NOT NULL) AS "hasActiveLogin", login.id AS "loginUserId" FROM client c LEFT JOIN app_user login ON login.organization_id = c.organization_id AND login.client_id = c.id AND login.status = 'active' WHERE c.organization_id=${ctx.organizationId} AND c.status='active' ORDER BY c.created_at DESC`,
    ),
    db.query(
      ctx,
      sql`SELECT id, code, legal_name AS "legalName", functional_currency AS "baseCurrency", timezone, tax_registration AS "taxRegistration", status, (status='active') AS "isActive" FROM finance_legal_entity WHERE organization_id=${ctx.organizationId} ORDER BY code`,
    ),
    db.query(
      ctx,
      sql`SELECT id, client_id AS "clientId", legal_entity_id AS "legalEntityId", contract_number AS "contractNumber", title, currency, billing_model AS "billingModel", start_date AS "startDate", end_date AS "endDate", status, version, renewal_term_months AS "renewalTermMonths", auto_renew AS "autoRenew", renewal_notice_days AS "renewalNoticeDays", retainer_quantity::text AS "retainerQuantity", retainer_unit AS "retainerUnit", overage_rate::text AS "overageRate", signed_status AS "signedStatus" FROM finance_contract WHERE organization_id=${ctx.organizationId} ORDER BY updated_at DESC`,
    ),
    db.query(
      ctx,
      sql`SELECT id, source_type AS "sourceType", source_id AS "sourceId", client_id AS "clientId", contract_id AS "contractId", service_key AS "serviceKey", event_date AS "eventDate", currency, quantity::text, amount::text, state FROM finance_billable_event WHERE organization_id=${ctx.organizationId} AND state='approved' ORDER BY event_date DESC`,
    ),
    db.maybeOne(
      ctx,
      sql`SELECT e.id AS "legalEntityId", e.functional_currency AS "functionalCurrency", c.supported_currencies AS "supportedCurrencies" FROM finance_configuration c JOIN finance_legal_entity e ON e.organization_id=c.organization_id AND e.id=c.default_legal_entity_id WHERE c.organization_id=${ctx.organizationId}`,
    ),
  ]);
  return { clients, entities, contracts, events, foundation };
}

const DRAFT = sql`SELECT id, client_id AS "clientId", legal_entity_id AS "legalEntityId", contract_id AS "contractId", period_start AS "periodStart", period_end AS "periodEnd", currency, status, subtotal::text, tax_total::text AS "taxTotal", discount_total::text AS "discountTotal", total::text, manifest_fingerprint AS "manifestFingerprint", version, reviewed_at AS "reviewedAt", created_at AS "createdAt" FROM finance_invoice_draft`;
const INVOICE = sql`SELECT i.id, i.client_id AS "clientId", i.legal_entity_id AS "legalEntityId", i.contract_id AS "contractId", i.invoice_number AS "invoiceNumber", i.invoice_date AS "invoiceDate", i.due_date AS "dueDate", i.currency, 'issued' AS status, i.receivable_status AS "receivableStatus", i.subtotal::text, i.tax_total::text AS "taxTotal", i.discount_total::text AS "discountTotal", i.total::text, i.manifest_fingerprint AS "manifestFingerprint", i.journal_id AS "journalId", i.issued_at AS "issuedAt", d.status AS "deliveryStatus" FROM finance_invoice i LEFT JOIN finance_invoice_delivery d ON d.organization_id=i.organization_id AND d.invoice_id=i.id`;
function paise(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
function lineAmount(quantity: string, unitPrice: string): bigint {
  const [whole = '0', fraction = ''] = quantity.split('.');
  const q = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  return (q * paise(unitPrice)) / 10000n;
}
function dateDiff(a: string, b: string): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
}
async function audit(
  ctx: RequestContext,
  action: string,
  targetId: string,
  before: unknown,
  after: unknown,
  reason: string,
  tx: Tx,
) {
  await tx.query(
    sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({ action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'invoice', targetId, before, after, reason, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`,
  );
}

function calculate(input: DraftInput) {
  let subtotal = 0n;
  let tax = 0n;
  let discount = 0n;
  const lines = input.sources.map((source) => {
    const gross = lineAmount(source.quantity, source.unitPrice);
    const lineDiscount = paise(source.discount);
    const taxable = gross - lineDiscount;
    if (taxable < 0n)
      throw new InvoicingValidationError('A line discount cannot exceed its line value.');
    const lineTax =
      (taxable * BigInt(source.taxRate.replace('.', ''))) /
      10n ** BigInt(source.taxRate.split('.')[1]?.length ?? 0) /
      100n;
    subtotal += gross;
    discount += lineDiscount;
    tax += lineTax;
    return {
      ...source,
      lineSubtotal: money(gross),
      lineTax: money(lineTax),
      lineTotal: money(taxable + lineTax),
    };
  });
  return {
    lines,
    subtotal: money(subtotal),
    taxTotal: money(tax),
    discountTotal: money(discount),
    total: money(subtotal + tax - discount),
  };
}

export async function listDrafts(ctx: RequestContext): Promise<InvoiceDraft[]> {
  return db.query<InvoiceDraft>(
    ctx,
    sql`${DRAFT} WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC`,
  );
}
export async function listInvoices(ctx: RequestContext): Promise<IssuedInvoice[]> {
  return db.query<IssuedInvoice>(
    ctx,
    sql`${INVOICE} WHERE i.organization_id=${ctx.organizationId} ORDER BY i.invoice_date DESC, i.issued_at DESC`,
  );
}
export async function getDraft(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<InvoiceDraft & { manifest: unknown }>(
    ctx,
    sql`SELECT id, client_id AS "clientId", legal_entity_id AS "legalEntityId", contract_id AS "contractId", period_start AS "periodStart", period_end AS "periodEnd", currency, status, subtotal::text, tax_total::text AS "taxTotal", discount_total::text AS "discountTotal", total::text, manifest_fingerprint AS "manifestFingerprint", version, reviewed_at AS "reviewedAt", created_at AS "createdAt", manifest FROM finance_invoice_draft WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  if (!row) throw new InvoicingNotFoundError('Invoice draft not found.');
  return row;
}

export async function createDraft(ctx: RequestContext, input: DraftInput) {
  if (dateDiff(input.periodStart, input.periodEnd) < 0)
    throw new InvoicingValidationError('Invoice period end must not precede its start.');
  const calc = calculate(input);
  const manifest = {
    clientId: input.clientId,
    legalEntityId: input.legalEntityId,
    contractId: input.contractId ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    currency: input.currency,
    purchaseOrderNumber: input.purchaseOrderNumber ?? null,
    lines: calc.lines,
    subtotal: calc.subtotal,
    taxTotal: calc.taxTotal,
    discountTotal: calc.discountTotal,
    total: calc.total,
  };
  const hash = fingerprint(manifest);
  const id = await db.transaction(ctx, async (tx) => {
    for (const source of input.sources) {
      if (source.sourceType === 'billable_event') {
        const event = await tx.maybeOne<{
          clientId: string;
          state: string;
          eventDate: string;
          currency: string;
          amount: string;
          quantity: string;
        }>(
          sql`SELECT client_id AS "clientId", state, event_date AS "eventDate", currency, amount::text, quantity::text FROM finance_billable_event WHERE organization_id=${ctx.organizationId} AND id=${source.sourceId} FOR SHARE`,
        );
        if (!event) throw new InvoicingNotFoundError('Billable event source not found.');
        if (event.clientId !== input.clientId || event.currency !== input.currency)
          throw new InvoicingValidationError(
            'Billable event source does not match the invoice client or currency.',
          );
        if (event.state !== 'approved')
          throw new InvoicingValidationError(
            'Only approved billable events can be invoiced.',
          );
        if (event.eventDate < input.periodStart || event.eventDate > input.periodEnd)
          throw new InvoicingValidationError(
            'Billable event is outside the invoice period.',
          );
        if (event.amount !== money(lineAmount(source.quantity, source.unitPrice)))
          throw new InvoicingValidationError(
            'Invoice amount does not match the approved billable event amount.',
          );
      }
    }
    const profile = await tx.maybeOne<{
      poRequired: boolean;
      creditLimit: string;
      creditControl: string;
    }>(
      sql`SELECT po_required AS "poRequired",credit_limit::text AS "creditLimit",credit_control AS "creditControl" FROM finance_client_billing_profile WHERE organization_id=${ctx.organizationId} AND client_id=${input.clientId} FOR SHARE`,
    );
    if (profile?.poRequired && !input.purchaseOrderNumber?.trim())
      throw new InvoicingValidationError(
        'A purchase order number is required by the client billing profile.',
      );
    if (profile?.creditControl === 'blocking' && Number(profile.creditLimit) > 0) {
      const outstanding = await tx.one<{ amount: string }>(
        sql`SELECT COALESCE(SUM(GREATEST(round(i.total*100)::bigint-COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0),0)),0)::text AS amount FROM finance_invoice i WHERE i.organization_id=${ctx.organizationId} AND i.client_id=${input.clientId} AND i.status='issued' AND i.receivable_status NOT IN ('paid','written_off')`,
      );
      if (
        BigInt(outstanding.amount) + paise(calc.total) >
        BigInt(Math.round(Number(profile.creditLimit) * 100))
      )
        throw new InvoicingValidationError(
          'The client credit limit would be exceeded by this invoice.',
        );
    }
    if (calc.taxTotal !== '0.00') {
      const config = await tx.maybeOne<{ status: string }>(
        sql`SELECT tax_policy_status AS status FROM finance_configuration WHERE organization_id=${ctx.organizationId} FOR SHARE`,
      );
      if (config?.status !== 'configured')
        throw new InvoicingValidationError(
          'Tax policy must be configured before issuing taxable invoice drafts.',
        );
    }
    if (input.contractId) {
      const contract = await tx.maybeOne<{
        clientId: string;
        currency: string;
        status: string;
        startDate: string;
        endDate: string | null;
      }>(
        sql`SELECT client_id AS "clientId",currency,status,start_date AS "startDate",end_date AS "endDate" FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${input.contractId} FOR SHARE`,
      );
      if (!contract) throw new InvoicingNotFoundError('Contract not found.');
      if (contract.clientId !== input.clientId)
        throw new InvoicingValidationError(
          'The contract does not belong to the selected client.',
        );
      if (contract.currency !== input.currency)
        throw new InvoicingValidationError(
          'Invoice currency does not match the contract currency.',
        );
      if (['cancelled', 'expired'].includes(contract.status))
        throw new InvoicingValidationError(
          'A cancelled or expired contract cannot be invoiced.',
        );
      if (
        input.periodStart < contract.startDate ||
        (contract.endDate && input.periodEnd > contract.endDate)
      )
        throw new InvoicingValidationError(
          'Invoice period falls outside the contract dates.',
        );
    }
    const duplicate = await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM finance_invoice_draft WHERE organization_id=${ctx.organizationId} AND client_id=${input.clientId} AND COALESCE(contract_id,'00000000-0000-0000-0000-000000000000')=COALESCE(${input.contractId ?? null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AND period_start=${input.periodStart}::date AND period_end=${input.periodEnd}::date AND status IN ('draft','issued') FOR SHARE`,
    );
    if (duplicate)
      throw new InvoicingConflictError(
        'An invoice draft or invoice already exists for this client and billing period.',
        'INVOICING_DUPLICATE_PERIOD',
      );
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_invoice_draft (organization_id,client_id,legal_entity_id,contract_id,period_start,period_end,currency,subtotal,tax_total,discount_total,total,manifest,manifest_fingerprint,created_by) VALUES (${ctx.organizationId},${input.clientId},${input.legalEntityId},${input.contractId ?? null},${input.periodStart},${input.periodEnd},${input.currency},${calc.subtotal},${calc.taxTotal},${calc.discountTotal},${calc.total},${JSON.stringify(manifest)}::jsonb,${hash},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, 'invoicing.draft.created', row.id, null, manifest, input.reason, tx);
    return row.id;
  });
  return getDraft(ctx, id);
}

export async function reviewDraft(ctx: RequestContext, id: string, input: ReviewInput) {
  const value = token();
  const hash = tokenHash(value);
  const result = await db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ version: number; status: string; fingerprint: string }>(
      sql`SELECT version,status,manifest_fingerprint AS fingerprint FROM finance_invoice_draft WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`,
    );
    if (row.status !== 'draft')
      throw new InvoicingConflictError('Only an open draft can be reviewed.');
    await tx.query(
      sql`UPDATE finance_invoice_draft SET review_token_hash=${hash},review_token_expires_at=now()+interval '15 minutes',reviewed_by=${ctx.principal.id},reviewed_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id}`,
    );
    await audit(
      ctx,
      'invoicing.draft.reviewed',
      id,
      null,
      { fingerprint: row.fingerprint, version: row.version },
      input.reason,
      tx,
    );
    return row;
  });
  return {
    draftId: id,
    reviewToken: value,
    manifestFingerprint: result.fingerprint,
    expiresInSeconds: 900,
  };
}

async function nextNumber(tx: Tx, organizationId: string, year: number) {
  await tx.query(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${year}`}))`,
  );
  const row = await tx.one<{ n: number }>(
    sql`SELECT COALESCE(max(substring(invoice_number from '[0-9]+$')::int),0)+1 AS n FROM finance_invoice WHERE organization_id=${organizationId} AND invoice_number LIKE ${`INV-${year}-%`}`,
  );
  return `INV-${year}-${String(row.n).padStart(6, '0')}`;
}
async function issueDraftTx(
  ctx: RequestContext,
  tx: Tx,
  id: string,
  reviewToken: string,
  manifestFingerprint: string,
  reason: string,
  expectedDraftFingerprint?: string,
) {
  const draft = await tx.one<
    InvoiceDraft & {
      manifest: Record<string, unknown>;
      reviewTokenHash: string | null;
      reviewTokenExpiresAt: string | null;
    }
  >(
    sql`SELECT id,client_id AS "clientId",legal_entity_id AS "legalEntityId",contract_id AS "contractId",period_start AS "periodStart",period_end AS "periodEnd",currency,status,subtotal::text,tax_total::text AS "taxTotal",discount_total::text AS "discountTotal",total::text,manifest,manifest_fingerprint AS "manifestFingerprint",version,review_token_hash AS "reviewTokenHash",review_token_expires_at AS "reviewTokenExpiresAt",reviewed_at AS "reviewedAt",created_at AS "createdAt" FROM finance_invoice_draft WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`,
  );
  if (draft.status !== 'draft')
    throw new InvoicingConflictError(
      'This draft has already been issued or cancelled.',
      'INVOICING_DRAFT_NOT_OPEN',
    );
  if (
    expectedDraftFingerprint
      ? draft.manifestFingerprint !== expectedDraftFingerprint
      : draft.manifestFingerprint !== manifestFingerprint ||
        draft.reviewTokenHash !== tokenHash(reviewToken) ||
        !draft.reviewTokenExpiresAt ||
        new Date(draft.reviewTokenExpiresAt).getTime() < Date.now()
  )
    throw new InvoicingConflictError(
      'The review token or invoice manifest is invalid or expired.',
      'INVOICING_REVIEW_TOKEN_INVALID',
    );
  const invoiceId = randomUUID();
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const number = await nextNumber(
    tx,
    ctx.organizationId,
    Number(invoiceDate.slice(0, 4)),
  );
  const terms = await tx.maybeOne<{ days: number }>(
    sql`SELECT payment_terms_days AS days FROM finance_client_billing_profile WHERE organization_id=${ctx.organizationId} AND client_id=${draft.clientId}`,
  );
  const dueDate = await tx.one<{ date: string }>(
    sql`SELECT (${invoiceDate}::date + ${terms?.days ?? 0}::int)::text AS date`,
  );
  const legalEntity = await tx.maybeOne<{ baseCurrency: string }>(
    sql`SELECT functional_currency AS "baseCurrency" FROM finance_legal_entity WHERE organization_id=${ctx.organizationId} AND id=${draft.legalEntityId}`,
  );
  if (!legalEntity)
    throw new InvoicingValidationError('The invoice legal entity could not be found.');
  if (draft.currency !== legalEntity.baseCurrency)
    throw new InvoicingValidationError(
      'A foreign-currency invoice requires a configured exchange rate before it can be issued.',
    );
  const sources = Array.isArray((draft.manifest as { lines?: unknown }).lines)
    ? (draft.manifest as { lines: unknown[] }).lines
    : [];
  for (const source of sources) {
    const line = source as { sourceType?: unknown; sourceId?: unknown };
    if (line.sourceType !== 'billable_event' || typeof line.sourceId !== 'string')
      continue;
    const billed = await tx.maybeOne<{ id: string }>(sql`
      UPDATE finance_billable_event
      SET state='billed', billed_quantity=quantity
      WHERE organization_id=${ctx.organizationId} AND id=${line.sourceId} AND state='approved'
      RETURNING id
    `);
    if (!billed)
      throw new InvoicingConflictError(
        'This billable event has already been billed or is no longer approved.',
        'INVOICING_SOURCE_NOT_BILLABLE',
      );
  }
  const journalLines = [
    {
      accountKey: 'accounts-receivable',
      amountPaise: paise(draft.total),
      side: 'debit' as const,
    },
    {
      accountKey: 'revenue',
      amountPaise: paise(draft.subtotal),
      side: 'credit' as const,
    },
    ...(paise(draft.discountTotal) > 0n
      ? [
          {
            accountKey: 'revenue',
            amountPaise: paise(draft.discountTotal),
            side: 'debit' as const,
          },
        ]
      : []),
    ...(paise(draft.taxTotal) > 0n
      ? [
          {
            accountKey: 'gst-payable',
            amountPaise: paise(draft.taxTotal),
            side: 'credit' as const,
          },
        ]
      : []),
  ];
  const journal = await postSourceJournalTx(tx, {
    organizationId: ctx.organizationId,
    postedBy: ctx.principal.id,
    entryDate: invoiceDate,
    sourceType: 'invoice',
    sourceId: invoiceId,
    description: `Invoice ${number}`,
    reason,
    transactionCurrency: draft.currency,
    baseCurrency: legalEntity.baseCurrency,
    exchangeRate: '1',
    lines: journalLines,
  });
  await tx.query(
    sql`INSERT INTO finance_invoice (id,organization_id,draft_id,invoice_number,client_id,legal_entity_id,contract_id,invoice_date,due_date,currency,subtotal,tax_total,discount_total,total,manifest,manifest_fingerprint,journal_id,issued_by) VALUES (${invoiceId},${ctx.organizationId},${id},${number},${draft.clientId},${draft.legalEntityId},${draft.contractId ?? null},${invoiceDate},${dueDate.date},${draft.currency},${draft.subtotal},${draft.taxTotal},${draft.discountTotal},${draft.total},${JSON.stringify(draft.manifest)}::jsonb,${draft.manifestFingerprint},${journal.journalId},${ctx.principal.id})`,
  );
  const client = await tx.maybeOne<{ email: string; clientName: string }>(
    sql`SELECT email::text,client_name AS "clientName" FROM client WHERE organization_id=${ctx.organizationId} AND id=${draft.clientId}`,
  );
  if (client)
    await tx.query(
      sql`INSERT INTO finance_invoice_delivery (organization_id,invoice_id,recipient,subject) VALUES (${ctx.organizationId},${invoiceId},${client.email},${`Invoice ${number} from TapCRM`})`,
    );
  await tx.query(
    sql`UPDATE finance_invoice_draft SET status='issued',issued_invoice_id=${invoiceId},review_token_hash=NULL,review_token_expires_at=NULL,version=version+1 WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  await audit(
    ctx,
    'invoicing.invoice.issued',
    invoiceId,
    { draftId: id },
    { invoiceNumber: number, total: draft.total, journalId: journal.journalId },
    reason,
    tx,
  );
  return { invoiceId, invoiceNumber: number, journalId: journal.journalId };
}
export async function confirmDraft(ctx: RequestContext, id: string, input: ConfirmInput) {
  const result = await db.transaction(ctx, (tx) =>
    issueDraftTx(ctx, tx, id, input.reviewToken, input.manifestFingerprint, input.reason),
  );
  const draft = await getDraft(ctx, id);
  const pdf = await renderInvoicePdf({ ...draft, invoiceNumber: result.invoiceNumber });
  const stored = await storeInvoicePdf(ctx.organizationId, result.invoiceId, pdf);
  await db.transaction(ctx, async (tx) => {
    await tx.query(
      sql`UPDATE finance_invoice SET pdf_relative_path=${stored.relativePath},pdf_sha256=${stored.sha256} WHERE organization_id=${ctx.organizationId} AND id=${result.invoiceId}`,
    );
  });
  return result;
}
export async function getPreview(ctx: RequestContext, id: string) {
  const draft = await getDraft(ctx, id);
  const contract = await db.maybeOne<{
    contractNumber: string;
    title: string;
    billingModel: string;
    currency: string;
    startDate: string;
    endDate: string | null;
    status: string;
  }>(
    ctx,
    sql`SELECT contract_number AS "contractNumber",title,billing_model AS "billingModel",currency,start_date AS "startDate",end_date AS "endDate",status FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${draft.contractId}`,
  );
  const profile = await db.maybeOne<{
    email: string | null;
    poRequired: boolean;
    paymentTermsDays: number;
  }>(
    ctx,
    sql`SELECT c.email::text,c.po_required AS "poRequired",c.payment_terms_days AS "paymentTermsDays" FROM finance_client_billing_profile c WHERE c.organization_id=${ctx.organizationId} AND c.client_id=${draft.clientId}`,
  );
  const manifest = draft.manifest as { purchaseOrderNumber?: string | null };
  const comparison = contract
    ? {
        currencyMatches: contract.currency === draft.currency,
        periodWithinContract:
          draft.periodStart >= contract.startDate &&
          (!contract.endDate || draft.periodEnd <= contract.endDate),
        status: contract.status,
        billingModel: contract.billingModel,
        purchaseOrderRequired: profile?.poRequired ?? false,
        purchaseOrderPresent: Boolean(manifest.purchaseOrderNumber),
      }
    : null;
  const emailPreview = {
    to: profile?.email ?? null,
    subject: `Invoice draft for ${draft.periodStart} to ${draft.periodEnd}`,
    body: `TapCRM invoice draft total: ${draft.currency} ${draft.total}. This is a preview only and has not been issued.`,
  };
  return {
    draft,
    contract,
    comparison,
    emailPreview,
    html: `<h1>TapCRM Invoice Draft</h1><p>Period: ${draft.periodStart} to ${draft.periodEnd}</p><p>Total: ${draft.currency} ${draft.total}</p><p>This is a preview only; human confirmation is required before release.</p>`,
  };
}
export async function downloadInvoicePdf(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<{ path: string; number: string }>(
    ctx,
    sql`SELECT pdf_relative_path AS path,invoice_number AS number FROM finance_invoice WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  if (!row?.path) throw new InvoicingNotFoundError('Invoice PDF is not available.');
  return { body: await readInvoicePdf(row.path), filename: `${row.number}.pdf` };
}

export async function reviewBatch(ctx: RequestContext, input: BatchReviewInput) {
  const value = token();
  const manifest = { drafts: [] as { id: string; fingerprint: string }[] };
  const requested = [...input.draftIds].sort();
  let hash = '';
  await db.transaction(ctx, async (tx) => {
    const rows = await tx.query<{ id: string; status: string; fingerprint: string }>(
      sql`SELECT id,status,manifest_fingerprint AS fingerprint FROM finance_invoice_draft WHERE organization_id=${ctx.organizationId} AND id=ANY(${requested}::uuid[]) FOR SHARE`,
    );
    if (rows.length !== requested.length || rows.some((row) => row.status !== 'draft'))
      throw new InvoicingValidationError(
        'Every selected draft must exist and remain open.',
      );
    manifest.drafts = rows
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ id: row.id, fingerprint: row.fingerprint }));
    hash = fingerprint(manifest);
    await tx.query(
      sql`INSERT INTO finance_invoice_batch_manifest (organization_id,draft_ids,manifest,manifest_fingerprint,token_hash,token_expires_at,created_by) VALUES (${ctx.organizationId},${requested}::uuid[],${JSON.stringify(manifest)}::jsonb,${hash},${tokenHash(value)},now()+interval '15 minutes',${ctx.principal.id})`,
    );
    await audit(ctx, 'invoicing.batch.reviewed', hash, null, manifest, input.reason, tx);
  });
  return { batchToken: value, manifestFingerprint: hash, expiresInSeconds: 900 };
}
export async function confirmBatch(ctx: RequestContext, input: BatchConfirmInput) {
  return db.transaction(ctx, async (tx) => {
    const batch = await tx.one<{
      manifest: { drafts: { id: string; fingerprint: string }[] };
      tokenHash: string;
      fingerprint: string;
      expiresAt: string;
      consumedAt: string | null;
    }>(
      sql`SELECT manifest,token_hash AS "tokenHash",manifest_fingerprint AS fingerprint,token_expires_at AS "expiresAt",consumed_at AS "consumedAt" FROM finance_invoice_batch_manifest WHERE organization_id=${ctx.organizationId} AND manifest_fingerprint=${input.manifestFingerprint} FOR UPDATE`,
    );
    if (
      batch.consumedAt ||
      batch.fingerprint !== input.manifestFingerprint ||
      batch.tokenHash !== tokenHash(input.batchToken) ||
      new Date(batch.expiresAt).getTime() < Date.now()
    )
      throw new InvoicingConflictError(
        'The batch review token or manifest is invalid or expired.',
        'INVOICING_BATCH_TOKEN_INVALID',
      );
    const issued = [];
    for (const entry of batch.manifest.drafts)
      issued.push(
        await issueDraftTx(
          ctx,
          tx,
          entry.id,
          '',
          input.manifestFingerprint,
          input.reason,
          entry.fingerprint,
        ),
      );
    await tx.query(
      sql`UPDATE finance_invoice_batch_manifest SET consumed_at=now() WHERE organization_id=${ctx.organizationId} AND manifest_fingerprint=${input.manifestFingerprint}`,
    );
    return issued;
  });
}
