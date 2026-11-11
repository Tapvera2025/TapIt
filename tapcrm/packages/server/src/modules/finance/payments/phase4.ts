import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { postSourceJournalTx } from '../accounting/facade.js';
import { refreshInvoiceStatus } from '../facade.js';
import { fingerprint } from '../invoicing/fingerprint.js';
import { storeBankImport } from './file-store.js';
import { hyperswitchAdapter } from './hyperswitch-adapter.js';
import { NotEligibleError } from '../../../platform/http/error-handler.js';
import type {
  AllocatePaymentInput,
  BankImportInput,
  BankMatchInput,
  ExceptionResolutionInput,
  FxRateInput,
  RecordReceiptInput,
  SettlementInput,
  VerifyReceiptInput,
  SettlementImportInput,
  FxRevaluationInput,
} from './validators.js';

const audit = async (
  ctx: RequestContext,
  action: string,
  targetId: string,
  after: unknown,
  reason: string,
  tx: Tx,
) => {
  await tx.query(
    sql`INSERT INTO audit_outbox (organization_id,stream,payload) VALUES (${ctx.organizationId},'activity',${JSON.stringify({ action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'payment', targetId, after, reason, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`,
  );
};
function csvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]!;
    const next = value[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      if (cell || row.length) {
        row.push(cell.trim());
        rows.push(row);
      }
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}
function minor(value: string): bigint {
  const cleaned = value.replaceAll(',', '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('PAYMENT_BANK_AMOUNT_INVALID');
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function safeMinor(value: string): bigint | null {
  try {
    return minor(value);
  } catch {
    return null;
  }
}
function headerIndex(headers: string[], names: string[]): number {
  const index = headers.findIndex((value) =>
    names.includes(value.toLowerCase().replaceAll(' ', '_')),
  );
  if (index < 0) throw new Error(`PAYMENT_BANK_COLUMN_MISSING:${names[0]}`);
  return index;
}

export async function recordReceipt(ctx: RequestContext, input: RecordReceiptInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO payment_receipt (organization_id,provider,provider_event_id,provider_payment_id,bank_reference,payer_label,amount_minor,currency,received_at,reported_by,fee_minor,exchange_rate_bps,cash_classification,state,idempotency_key,note) VALUES (${ctx.organizationId},${input.provider},${input.providerEventId ?? null},${input.providerPaymentId ?? null},${input.bankReference ?? null},${input.payerLabel ?? null},${input.amountMinor},${input.currency},${input.receivedAt ? new Date(input.receivedAt) : new Date()},${ctx.principal.id},${input.feeMinor},${input.exchangeRateBps ?? null},${input.cashClassification},'reported',${input.idempotencyKey},${input.note ?? null}) ON CONFLICT (organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at=now() RETURNING id`,
    );
    await audit(
      ctx,
      'payments.receipt.recorded',
      row.id,
      {
        provider: input.provider,
        amountMinor: input.amountMinor.toString(),
        currency: input.currency,
      },
      input.reason,
      tx,
    );
    return { id: row.id, state: 'reported' };
  });
}

export async function listReceipts(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT pr.id,pr.provider,pr.provider_event_id AS "providerEventId",pr.provider_payment_id AS "providerPaymentId",pr.bank_reference AS "bankReference",pr.amount_minor::text AS "amountMinor",pr.currency,pr.received_at AS "receivedAt",pr.fee_minor::text AS "feeMinor",pr.cash_classification AS "cashClassification",pr.state,pr.verified_journal_id AS "verifiedJournalId",COALESCE(SUM(pa.amount_minor),0)::text AS "allocatedMinor",GREATEST(pr.amount_minor-COALESCE(SUM(pa.amount_minor),0),0)::text AS "remainingMinor",EXISTS (SELECT 1 FROM finance_payment_settlement_receipt sr WHERE sr.organization_id=pr.organization_id AND sr.receipt_id=pr.id) AS settled FROM payment_receipt pr LEFT JOIN payment_allocation pa ON pa.organization_id=pr.organization_id AND pa.receipt_id=pr.id WHERE pr.organization_id=${ctx.organizationId} GROUP BY pr.id ORDER BY pr.received_at DESC`,
  );
}

export async function listAllocatableInvoices(ctx: RequestContext, receiptId: string) {
  const receipt = await db.one<{ currency: string }>(
    ctx,
    sql`SELECT currency FROM payment_receipt WHERE organization_id=${ctx.organizationId} AND id=${receiptId}`,
  );
  return db.query(
    ctx,
    sql`SELECT i.id,i.invoice_number AS "invoiceNumber",i.invoice_date AS "invoiceDate",i.due_date AS "dueDate",i.currency,i.total::text AS total,GREATEST(round(i.total*100)::bigint-COALESCE(SUM(pa.amount_minor),0),0)::text AS "outstandingMinor" FROM finance_invoice i LEFT JOIN payment_allocation pa ON pa.organization_id=i.organization_id AND pa.invoice_id=i.id WHERE i.organization_id=${ctx.organizationId} AND i.status='issued' AND i.currency=${receipt.currency} GROUP BY i.id HAVING GREATEST(round(i.total*100)::bigint-COALESCE(SUM(pa.amount_minor),0),0)>0 ORDER BY i.due_date ASC NULLS LAST,i.invoice_number ASC`,
  );
}

async function postReceiptTx(
  ctx: RequestContext,
  tx: Tx,
  receiptId: string,
  reason: string,
) {
  const receipt = await tx.one<{
    provider: string;
    amount: string;
    fee: string;
    currency: string;
    rate: number | null;
    cashClassification: 'receivable' | 'unapplied' | 'advance';
    state: string;
    journalId: string | null;
  }>(
    sql`SELECT pr.provider,pr.amount_minor::text AS amount,pr.fee_minor::text AS fee,pr.currency,pr.exchange_rate_bps AS rate,pr.cash_classification AS "cashClassification",pr.state,pr.verified_journal_id AS "journalId" FROM payment_receipt pr WHERE pr.organization_id=${ctx.organizationId} AND pr.id=${receiptId} FOR UPDATE`,
  );
  if (receipt.state !== 'reported') return receipt.journalId;
  const amount = BigInt(receipt.amount);
  const fee = BigInt(receipt.fee);
  if (receipt.currency !== 'INR' && !receipt.rate)
    throw new Error('PAYMENT_FX_RATE_REQUIRED');
  const converted =
    receipt.currency === 'INR' ? amount : (amount * BigInt(receipt.rate!)) / 10000n;
  const convertedFee =
    receipt.currency === 'INR' ? fee : (fee * BigInt(receipt.rate!)) / 10000n;
  const debitAccount =
    receipt.provider === 'bank_transfer' ||
    receipt.provider === 'cash' ||
    receipt.provider === 'cheque' ||
    receipt.provider === 'manual'
      ? 'bank'
      : 'gateway-clearing';
  const creditAccount =
    receipt.cashClassification === 'advance'
      ? 'advances-from-customers'
      : receipt.cashClassification === 'unapplied'
        ? 'payment-suspense'
        : 'accounts-receivable';
  const lines = [
    {
      accountKey: debitAccount,
      amountPaise: converted > convertedFee ? converted - convertedFee : converted,
      side: 'debit' as const,
    },
    ...(convertedFee > 0n
      ? [
          {
            accountKey: 'gateway-fee-expense',
            amountPaise: convertedFee,
            side: 'debit' as const,
          },
        ]
      : []),
    {
      accountKey: creditAccount,
      amountPaise: converted,
      side: 'credit' as const,
    },
  ];
  const journal = await postSourceJournalTx(tx, {
    organizationId: ctx.organizationId,
    postedBy: ctx.principal.id,
    entryDate: new Date().toISOString().slice(0, 10),
    sourceType: 'payment_receipt',
    sourceId: receiptId,
    description: `Payment receipt via ${receipt.provider}`,
    reason,
    lines,
  });
  await tx.query(
    sql`UPDATE payment_receipt SET state='verified',verified_by=${ctx.principal.id},verified_at=now(),verified_journal_id=${journal.journalId} WHERE organization_id=${ctx.organizationId} AND id=${receiptId}`,
  );
  return journal.journalId;
}
export async function verifyReceipt(
  ctx: RequestContext,
  id: string,
  input: VerifyReceiptInput,
) {
  return db.transaction(ctx, async (tx) => {
    const journalId = await postReceiptTx(ctx, tx, id, input.reason);
    await audit(ctx, 'payments.receipt.verified', id, { journalId }, input.reason, tx);
    return { id, state: 'verified', journalId };
  });
}

export async function allocateReceipt(
  ctx: RequestContext,
  receiptId: string,
  input: AllocatePaymentInput,
) {
  return db.transaction(ctx, async (tx) => {
    const receipt = await tx.one<{
      amount: string;
      state: string;
      currency: string;
      cashClassification: 'receivable' | 'unapplied' | 'advance';
      rate: number | null;
    }>(
      sql`SELECT amount_minor::text AS amount,state,currency,cash_classification AS "cashClassification",exchange_rate_bps AS rate FROM payment_receipt WHERE organization_id=${ctx.organizationId} AND id=${receiptId} FOR UPDATE`,
    );
    if (!['verified', 'reconciled'].includes(receipt.state))
      throw new Error('PAYMENT_RECEIPT_NOT_VERIFIED');
    const allocated = await tx.one<{ amount: string }>(
      sql`SELECT COALESCE(sum(amount_minor),0)::text AS amount FROM payment_allocation WHERE organization_id=${ctx.organizationId} AND receipt_id=${receiptId}`,
    );
    const remaining = BigInt(receipt.amount) - BigInt(allocated.amount);
    if (remaining <= 0n)
      throw new NotEligibleError(
        'PAYMENT_RECEIPT_FULLY_ALLOCATED',
        'This receipt has already been fully allocated.',
        {
          unmet: ['receipt_remaining_amount > 0'],
          actual: { remainingMinor: remaining.toString() },
        },
      );
    if (input.amountMinor > remaining)
      throw new NotEligibleError(
        'PAYMENT_ALLOCATION_EXCEEDS_RECEIPT',
        `Allocation amount cannot exceed the receipt balance of ${remaining.toString()} minor units.`,
        {
          unmet: ['allocation_amount <= receipt_remaining_amount'],
          actual: {
            allocationMinor: input.amountMinor.toString(),
            remainingMinor: remaining.toString(),
          },
        },
      );
    if (input.invoiceId) {
      const invoice = await tx.one<{ totalMinor: string; currency: string }>(
        sql`SELECT round(total * 100)::bigint::text AS "totalMinor",currency FROM finance_invoice WHERE organization_id=${ctx.organizationId} AND id=${input.invoiceId}`,
      );
      if (invoice.currency !== receipt.currency)
        throw new Error('PAYMENT_CURRENCY_MISMATCH');
      const paid = await tx.one<{ amount: string }>(
        sql`SELECT COALESCE(sum(amount_minor),0)::text AS amount FROM payment_allocation WHERE organization_id=${ctx.organizationId} AND invoice_id=${input.invoiceId}`,
      );
      const invoiceRemaining = BigInt(invoice.totalMinor) - BigInt(paid.amount);
      if (invoiceRemaining <= 0n)
        throw new NotEligibleError(
          'PAYMENT_INVOICE_FULLY_PAID',
          'This invoice has no outstanding balance.',
          {
            unmet: ['invoice_outstanding_amount > 0'],
            actual: { outstandingMinor: invoiceRemaining.toString() },
          },
        );
      if (input.amountMinor > invoiceRemaining)
        throw new NotEligibleError(
          'PAYMENT_ALLOCATION_EXCEEDS_INVOICE',
          `Allocation amount cannot exceed the invoice balance of ${invoiceRemaining.toString()} minor units.`,
          {
            unmet: ['allocation_amount <= invoice_outstanding_amount'],
            actual: {
              allocationMinor: input.amountMinor.toString(),
              outstandingMinor: invoiceRemaining.toString(),
            },
          },
        );
    }
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO payment_allocation (organization_id,receipt_id,deal_id,invoice_id,amount_minor,allocated_by) VALUES (${ctx.organizationId},${receiptId},${input.dealId ?? null},${input.invoiceId ?? null},${input.amountMinor},${ctx.principal.id}) ON CONFLICT DO NOTHING RETURNING id`,
    );
    if (!row) throw new Error('PAYMENT_ALLOCATION_DUPLICATE');
    if (input.invoiceId && receipt.cashClassification !== 'receivable') {
      const amount = input.amountMinor;
      const converted =
        receipt.currency === 'INR'
          ? amount
          : (amount * BigInt(receipt.rate ?? 10000)) / 10000n;
      const sourceAccount =
        receipt.cashClassification === 'advance'
          ? 'advances-from-customers'
          : 'payment-suspense';
      await postSourceJournalTx(tx, {
        organizationId: ctx.organizationId,
        postedBy: ctx.principal.id,
        entryDate: new Date().toISOString().slice(0, 10),
        sourceType: 'payment_allocation',
        sourceId: row.id,
        description: `Allocate payment ${receiptId} to invoice`,
        reason: input.reason,
        lines: [
          { accountKey: sourceAccount, amountPaise: converted, side: 'debit' },
          { accountKey: 'accounts-receivable', amountPaise: converted, side: 'credit' },
        ],
      });
    }
    if (input.amountMinor === remaining)
      await tx.query(
        sql`UPDATE payment_receipt SET state='reconciled' WHERE organization_id=${ctx.organizationId} AND id=${receiptId}`,
      );
    if (input.invoiceId)
      await refreshInvoiceStatus(tx, ctx.organizationId, input.invoiceId);
    await audit(
      ctx,
      'payments.receipt.allocated',
      row.id,
      {
        receiptId,
        invoiceId: input.invoiceId ?? null,
        dealId: input.dealId ?? null,
        amountMinor: input.amountMinor.toString(),
      },
      input.reason,
      tx,
    );
    return { id: row.id, receiptId, amountMinor: input.amountMinor.toString() };
  });
}

export async function importBankCsv(ctx: RequestContext, input: BankImportInput) {
  const body = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (body.length > 10 * 1024 * 1024) throw new Error('PAYMENT_BANK_FILE_TOO_LARGE');
  const stored = await storeBankImport(ctx.organizationId, input.originalFilename, body);
  return db.transaction(ctx, async (tx) => {
    const rows = csvRows(body.toString('utf8'));
    if (rows.length < 2) throw new Error('PAYMENT_BANK_FILE_EMPTY');
    const headers = rows[0]!.map((value) => value.toLowerCase().replaceAll(' ', '_'));
    const dateIndex = headerIndex(headers, ['transaction_date', 'date']);
    const referenceIndex = headerIndex(headers, [
      'reference',
      'utr',
      'transaction_reference',
    ]);
    const descriptionIndex = headerIndex(headers, ['description', 'narration']);
    const debitIndex = headerIndex(headers, ['debit', 'debit_amount']);
    const creditIndex = headerIndex(headers, ['credit', 'credit_amount']);
    const currencyIndex = headers.findIndex((value) =>
      ['currency', 'ccy'].includes(value),
    );
    const balanceIndex = headers.findIndex((value) =>
      ['balance', 'closing_balance'].includes(value),
    );
    const importRow = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_bank_statement_import (organization_id,original_filename,stored_filename,relative_path,sha256,format,uploaded_by) VALUES (${ctx.organizationId},${input.originalFilename},${stored.storedFilename},${stored.relativePath},${stored.sha256},${input.format},${ctx.principal.id}) ON CONFLICT (organization_id,sha256) DO UPDATE SET status='imported' RETURNING id`,
    );
    let count = 0;
    let invalid = 0;
    for (const values of rows.slice(1)) {
      const date = values[dateIndex] ?? '';
      const debit = values[debitIndex] ?? '0';
      const credit = values[creditIndex] ?? '0';
      const debitMinor = debit ? safeMinor(debit) : 0n;
      const creditMinor = credit ? safeMinor(credit) : 0n;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        debitMinor === null ||
        creditMinor === null ||
        (debitMinor === 0n) === (creditMinor === 0n)
      ) {
        invalid += 1;
        await tx.query(
          sql`INSERT INTO finance_payment_exception (organization_id,exception_type,status,reason,payload) VALUES (${ctx.organizationId},'bank_line_invalid','open','Bank statement row failed validation',${JSON.stringify({ row: values, rowNumber: count + invalid })}::jsonb)`,
        );
        continue;
      }
      const lineHash = fingerprint({
        date,
        reference: values[referenceIndex] ?? '',
        description: values[descriptionIndex] ?? '',
        debit,
        credit,
        currency: currencyIndex >= 0 ? (values[currencyIndex] ?? 'INR') : 'INR',
      });
      await tx.query(
        sql`INSERT INTO finance_bank_statement_line (organization_id,import_id,line_fingerprint,transaction_date,reference,description,debit_minor,credit_minor,currency,balance_minor) VALUES (${ctx.organizationId},${importRow.id},${lineHash},${date},${values[referenceIndex] ?? null},${values[descriptionIndex] ?? null},${debitMinor},${creditMinor},${currencyIndex >= 0 ? (values[currencyIndex] ?? 'INR') : 'INR'},${balanceIndex >= 0 && values[balanceIndex] ? minor(values[balanceIndex]) : null}) ON CONFLICT (organization_id,line_fingerprint) DO NOTHING`,
      );
      count += 1;
    }
    await tx.query(
      sql`UPDATE finance_bank_statement_import SET row_count=${count} WHERE organization_id=${ctx.organizationId} AND id=${importRow.id}`,
    );
    await audit(
      ctx,
      'payments.bank_imported',
      importRow.id,
      { filename: input.originalFilename, rowCount: count, invalidRows: invalid },
      'Bank CSV imported',
      tx,
    );
    if (invalid > 0)
      await tx.query(
        sql`UPDATE finance_bank_statement_import SET status='partially_matched' WHERE organization_id=${ctx.organizationId} AND id=${importRow.id}`,
      );
    return { id: importRow.id, rowCount: count, invalidRows: invalid };
  });
}

export async function matchBankLine(
  ctx: RequestContext,
  lineId: string,
  input: BankMatchInput,
) {
  return db.transaction(ctx, async (tx) => {
    const line = await tx.one<{
      credit: string;
      currency: string;
      reference: string | null;
      matchedReceiptId: string | null;
    }>(
      sql`SELECT credit_minor::text AS credit,currency,reference,matched_receipt_id AS "matchedReceiptId" FROM finance_bank_statement_line WHERE organization_id=${ctx.organizationId} AND id=${lineId} FOR UPDATE`,
    );
    if (line.matchedReceiptId)
      throw new NotEligibleError(
        'PAYMENT_BANK_LINE_ALREADY_MATCHED',
        'This bank line has already been matched to a receipt.',
        { unmet: ['bank_line.matched_receipt_id IS NULL'] },
      );
    if (BigInt(line.credit) <= 0n)
      throw new NotEligibleError(
        'PAYMENT_BANK_LINE_NOT_INCOMING',
        'Only incoming credit bank lines can be matched to payment receipts.',
        { unmet: ['credit_amount > 0'], actual: { creditMinor: line.credit } },
      );
    let receiptId = input.receiptId;
    if (!receiptId && input.createReceipt) {
      const existing = line.reference
        ? await tx.maybeOne<{ id: string; amount: string; currency: string }>(
            sql`SELECT id,amount_minor::text AS amount,currency FROM payment_receipt WHERE organization_id=${ctx.organizationId} AND provider='bank_transfer' AND bank_reference=${line.reference} FOR UPDATE`,
          )
        : null;
      if (existing) {
        if (
          existing.currency !== line.currency ||
          BigInt(existing.amount) !== BigInt(line.credit)
        )
          throw new Error('PAYMENT_BANK_RECEIPT_MISMATCH');
        receiptId = existing.id;
      } else {
        const receipt = await tx.one<{ id: string }>(
          sql`INSERT INTO payment_receipt (organization_id,provider,bank_reference,amount_minor,currency,received_at,reported_by,cash_classification,state,idempotency_key,note) VALUES (${ctx.organizationId},'bank_transfer',${line.reference},${line.credit},${line.currency},now(),${ctx.principal.id},'unapplied','reported',${`bank-line:${lineId}`},'Imported from bank statement') RETURNING id`,
        );
        receiptId = receipt.id;
      }
    }
    if (!receiptId) throw new Error('PAYMENT_RECEIPT_REQUIRED');
    await tx.query(
      sql`UPDATE finance_bank_statement_line SET matched_receipt_id=${receiptId} WHERE organization_id=${ctx.organizationId} AND id=${lineId}`,
    );
    await audit(
      ctx,
      'payments.bank_line_matched',
      lineId,
      { receiptId },
      input.reason,
      tx,
    );
    return { lineId, receiptId };
  });
}
export async function listBankLines(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT id,import_id AS "importId",transaction_date AS "transactionDate",value_date AS "valueDate",reference,description,debit_minor::text AS "debitMinor",credit_minor::text AS "creditMinor",currency,matched_receipt_id AS "matchedReceiptId" FROM finance_bank_statement_line WHERE organization_id=${ctx.organizationId} ORDER BY transaction_date DESC`,
  );
}
export async function createSettlement(ctx: RequestContext, input: SettlementInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_payment_settlement
      (organization_id, provider, settlement_reference, settlement_date, currency, gross_minor, fee_minor, net_minor, exchange_rate_bps, created_by)
      VALUES (${ctx.organizationId}, ${input.provider}, ${input.settlementReference}, ${input.settlementDate}, ${input.currency}, ${input.grossMinor}, ${input.feeMinor}, ${input.netMinor}, ${input.exchangeRateBps ?? null}, ${ctx.principal.id})
      ON CONFLICT (organization_id, provider, settlement_reference) DO UPDATE SET gross_minor=EXCLUDED.gross_minor, fee_minor=EXCLUDED.fee_minor, net_minor=EXCLUDED.net_minor, exchange_rate_bps=EXCLUDED.exchange_rate_bps
      RETURNING id`);
    let matched = 0n;
    let receiptBaseNet = 0n;
    for (const receiptId of input.receiptIds) {
      const receipt = await tx.one<{
        provider: string;
        currency: string;
        amount: string;
        fee: string;
        rate: number | null;
        state: string;
      }>(
        sql`SELECT provider, currency, amount_minor::text AS amount, fee_minor::text AS fee, exchange_rate_bps AS rate, state FROM payment_receipt WHERE organization_id=${ctx.organizationId} AND id=${receiptId} FOR UPDATE`,
      );
      if (
        receipt.provider !== input.provider ||
        receipt.currency !== input.currency ||
        !['verified', 'reconciled'].includes(receipt.state)
      )
        throw new NotEligibleError(
          'PAYMENT_SETTLEMENT_RECEIPT_INVALID',
          'Selected receipt is not eligible for this settlement.',
          {
            unmet: [
              'receipt.provider = settlement.provider',
              'receipt.currency = settlement.currency',
              'receipt.state IN (verified, reconciled)',
            ],
            actual: {
              provider: receipt.provider,
              currency: receipt.currency,
              state: receipt.state,
            },
          },
        );
      const alreadySettled = await tx.maybeOne<{ id: string }>(
        sql`SELECT id FROM finance_payment_settlement_receipt WHERE organization_id=${ctx.organizationId} AND receipt_id=${receiptId} LIMIT 1`,
      );
      if (alreadySettled)
        throw new NotEligibleError(
          'PAYMENT_SETTLEMENT_RECEIPT_ALREADY_SETTLED',
          'Selected receipt has already been included in a settlement.',
          { unmet: ['receipt has no existing settlement'] },
        );
      const amount = BigInt(receipt.amount);
      const receiptRate = BigInt(receipt.rate ?? 10000);
      await tx.query(
        sql`INSERT INTO finance_payment_settlement_receipt (organization_id, settlement_id, receipt_id, amount_minor) VALUES (${ctx.organizationId}, ${row.id}, ${receiptId}, ${amount}) ON CONFLICT (organization_id, settlement_id, receipt_id) DO NOTHING`,
      );
      matched += amount;
      receiptBaseNet += ((amount - BigInt(receipt.fee)) * receiptRate) / 10000n;
    }
    if (input.receiptIds.length > 0 && matched !== input.grossMinor) {
      await tx.query(
        sql`UPDATE finance_payment_settlement SET status='mismatched', mismatch_reason=${`Matched receipts ${matched} do not equal settlement gross ${input.grossMinor}`} WHERE organization_id=${ctx.organizationId} AND id=${row.id}`,
      );
      await tx.query(
        sql`INSERT INTO finance_payment_exception (organization_id, exception_type, status, reason, payload) VALUES (${ctx.organizationId}, 'settlement_mismatch', 'open', 'Settlement gross does not match selected receipts', ${JSON.stringify({ settlementId: row.id, matched: matched.toString(), gross: input.grossMinor.toString() })}::jsonb)`,
      );
    } else if (input.receiptIds.length > 0) {
      const settlementNet =
        (input.netMinor * BigInt(input.exchangeRateBps ?? 10000)) / 10000n;
      const difference = settlementNet - receiptBaseNet;
      const lines = [
        { accountKey: 'bank', amountPaise: settlementNet, side: 'debit' as const },
        {
          accountKey: 'gateway-clearing',
          amountPaise: receiptBaseNet,
          side: 'credit' as const,
        },
        ...(difference > 0n
          ? [{ accountKey: 'fx-gain', amountPaise: difference, side: 'credit' as const }]
          : difference < 0n
            ? [
                {
                  accountKey: 'fx-loss',
                  amountPaise: -difference,
                  side: 'debit' as const,
                },
              ]
            : []),
      ];
      const journal = await postSourceJournalTx(tx, {
        organizationId: ctx.organizationId,
        postedBy: ctx.principal.id,
        entryDate: input.settlementDate,
        sourceType: 'payment_settlement',
        sourceId: row.id,
        description: `Settlement ${input.settlementReference}`,
        reason: input.reason,
        lines,
      });
      await tx.query(
        sql`UPDATE finance_payment_settlement SET status='reconciled', journal_id=${journal.journalId} WHERE organization_id=${ctx.organizationId} AND id=${row.id}`,
      );
    }
    await audit(
      ctx,
      'payments.settlement.recorded',
      row.id,
      {
        provider: input.provider,
        reference: input.settlementReference,
        receiptCount: input.receiptIds.length,
      },
      input.reason,
      tx,
    );
    return {
      id: row.id,
      status:
        input.receiptIds.length === 0
          ? 'pending'
          : matched !== input.grossMinor
            ? 'mismatched'
            : 'reconciled',
    };
  });
}
export async function recordFxRate(ctx: RequestContext, input: FxRateInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_payment_fx_rate (organization_id,base_currency,quote_currency,rate_bps,effective_at,source,created_by) VALUES (${ctx.organizationId},${input.baseCurrency},${input.quoteCurrency},${input.rateBps},${input.effectiveAt},${input.source},${ctx.principal.id}) ON CONFLICT (organization_id,base_currency,quote_currency,effective_at) DO UPDATE SET rate_bps=EXCLUDED.rate_bps,source=EXCLUDED.source RETURNING id`,
    );
    await audit(
      ctx,
      'payments.fx_rate.recorded',
      row.id,
      {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rateBps: input.rateBps,
      },
      input.reason,
      tx,
    );
    return row;
  });
}
export async function importSettlementCsv(
  ctx: RequestContext,
  input: SettlementImportInput,
) {
  const body = Buffer.from(input.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (body.length > 10 * 1024 * 1024)
    throw new Error('PAYMENT_SETTLEMENT_FILE_TOO_LARGE');
  const stored = await storeBankImport(ctx.organizationId, input.originalFilename, body);
  return db.transaction(ctx, async (tx) => {
    const rows = csvRows(body.toString('utf8'));
    if (rows.length < 2) throw new Error('PAYMENT_SETTLEMENT_FILE_EMPTY');
    const headers = rows[0]!.map((value) => value.toLowerCase().replaceAll(' ', '_'));
    const refIndex = headerIndex(headers, [
      'settlement_reference',
      'reference',
      'settlement_id',
    ]);
    const dateIndex = headerIndex(headers, ['settlement_date', 'date']);
    const currencyIndex = headerIndex(headers, ['currency', 'ccy']);
    const grossIndex = headerIndex(headers, ['gross', 'gross_amount']);
    const feeIndex = headerIndex(headers, ['fee', 'fee_amount']);
    const netIndex = headerIndex(headers, ['net', 'net_amount']);
    const rateIndex = headers.findIndex((value) =>
      ['exchange_rate_bps', 'rate_bps'].includes(value),
    );
    const receiptIndex = headers.findIndex((value) =>
      ['receipt_ids', 'receipts'].includes(value),
    );
    const importRow = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_payment_settlement_import (organization_id,original_filename,stored_filename,relative_path,sha256,provider,uploaded_by) VALUES (${ctx.organizationId},${input.originalFilename},${stored.storedFilename},${stored.relativePath},${stored.sha256},${input.provider},${ctx.principal.id}) ON CONFLICT (organization_id,sha256) DO UPDATE SET provider=EXCLUDED.provider RETURNING id`,
    );
    let count = 0;
    let invalid = 0;
    for (const values of rows.slice(1)) {
      const reference = values[refIndex] ?? '';
      const date = values[dateIndex] ?? '';
      const currency = (values[currencyIndex] ?? '').toUpperCase();
      const gross = safeMinor(values[grossIndex] ?? '');
      const fee = safeMinor(values[feeIndex] ?? '');
      const net = safeMinor(values[netIndex] ?? '');
      if (
        !reference ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !/^[A-Z]{3}$/.test(currency) ||
        gross === null ||
        fee === null ||
        net === null ||
        net !== gross - fee
      ) {
        invalid += 1;
        await tx.query(
          sql`INSERT INTO finance_payment_exception (organization_id,exception_type,status,reason,payload) VALUES (${ctx.organizationId},'settlement_row_invalid','open','Settlement statement row failed validation',${JSON.stringify({ row: values })}::jsonb)`,
        );
        continue;
      }
      const receiptIds =
        receiptIndex >= 0
          ? (values[receiptIndex] ?? '')
              .split(';')
              .map((value) => value.trim())
              .filter(Boolean)
          : [];
      await tx.query(
        sql`INSERT INTO finance_payment_settlement (organization_id,provider,settlement_reference,settlement_date,currency,gross_minor,fee_minor,net_minor,exchange_rate_bps,created_by) VALUES (${ctx.organizationId},${input.provider},${reference},${date},${currency},${gross},${fee},${net},${rateIndex >= 0 && values[rateIndex] ? Number(values[rateIndex]) : null},${ctx.principal.id}) ON CONFLICT (organization_id,provider,settlement_reference) DO UPDATE SET gross_minor=EXCLUDED.gross_minor,fee_minor=EXCLUDED.fee_minor,net_minor=EXCLUDED.net_minor,exchange_rate_bps=EXCLUDED.exchange_rate_bps`,
      );
      if (receiptIds.length > 0)
        await tx.query(
          sql`INSERT INTO finance_payment_exception (organization_id,exception_type,status,reason,payload) VALUES (${ctx.organizationId},'settlement_review_required','open','Imported settlement requires receipt matching review',${JSON.stringify({ provider: input.provider, reference, receiptIds })}::jsonb)`,
        );
      count += 1;
    }
    await tx.query(
      sql`UPDATE finance_payment_settlement_import SET row_count=${count},status=${invalid > 0 ? 'partially_reconciled' : 'imported'} WHERE organization_id=${ctx.organizationId} AND id=${importRow.id}`,
    );
    await audit(
      ctx,
      'payments.settlement_imported',
      importRow.id,
      { filename: input.originalFilename, rowCount: count, invalidRows: invalid },
      input.reason,
      tx,
    );
    return { id: importRow.id, rowCount: count, invalidRows: invalid };
  });
}
export async function revalueFx(ctx: RequestContext, input: FxRevaluationInput) {
  return db.transaction(ctx, async (tx) => {
    const rows = await tx.query<{ amount: string; fee: string; rate: number | null }>(
      sql`SELECT pr.amount_minor::text AS amount,pr.fee_minor::text AS fee,pr.exchange_rate_bps AS rate FROM payment_receipt pr WHERE pr.organization_id=${ctx.organizationId} AND pr.currency=${input.currency} AND pr.received_at::date<=${input.asOfDate} AND pr.state IN ('verified','reconciled') AND NOT EXISTS (SELECT 1 FROM finance_payment_settlement_receipt sr WHERE sr.organization_id=pr.organization_id AND sr.receipt_id=pr.id)`,
    );
    if (rows.length === 0)
      throw new NotEligibleError(
        'PAYMENT_FX_NO_ELIGIBLE_BALANCE',
        `No open verified ${input.currency} receipts are available for FX revaluation on ${input.asOfDate}.`,
        {
          unmet: [
            'receipt.currency = revaluation.currency',
            'receipt.received_at <= revaluation.as_of_date',
            'receipt.state IN (verified, reconciled)',
            'receipt is not already settled',
          ],
        },
      );
    const carrying = rows.reduce(
      (total, row) =>
        total +
        ((BigInt(row.amount) - BigInt(row.fee)) * BigInt(row.rate ?? 10000)) / 10000n,
      0n,
    );
    const revalued = rows.reduce(
      (total, row) =>
        total + ((BigInt(row.amount) - BigInt(row.fee)) * BigInt(input.rateBps)) / 10000n,
      0n,
    );
    const difference = revalued - carrying;
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_payment_fx_revaluation (organization_id,currency,as_of_date,rate_bps,carrying_minor,revalued_minor,difference_minor,created_by) VALUES (${ctx.organizationId},${input.currency},${input.asOfDate},${input.rateBps},${carrying},${revalued},${difference},${ctx.principal.id}) RETURNING id`,
    );
    let journalId: string | null = null;
    if (difference !== 0n) {
      const journal = await postSourceJournalTx(tx, {
        organizationId: ctx.organizationId,
        postedBy: ctx.principal.id,
        entryDate: input.asOfDate,
        sourceType: 'payment_fx_revaluation',
        sourceId: row.id,
        description: `FX revaluation ${input.currency} at ${input.asOfDate}`,
        reason: input.reason,
        lines:
          difference > 0n
            ? [
                {
                  accountKey: 'gateway-clearing',
                  amountPaise: difference,
                  side: 'debit',
                },
                { accountKey: 'fx-gain', amountPaise: difference, side: 'credit' },
              ]
            : [
                { accountKey: 'fx-loss', amountPaise: -difference, side: 'debit' },
                {
                  accountKey: 'gateway-clearing',
                  amountPaise: -difference,
                  side: 'credit',
                },
              ],
      });
      journalId = journal.journalId;
      await tx.query(
        sql`UPDATE finance_payment_fx_revaluation SET journal_id=${journalId} WHERE organization_id=${ctx.organizationId} AND id=${row.id}`,
      );
    }
    await audit(
      ctx,
      'payments.fx_revalued',
      row.id,
      {
        currency: input.currency,
        asOfDate: input.asOfDate,
        carrying: carrying.toString(),
        revalued: revalued.toString(),
        journalId,
      },
      input.reason,
      tx,
    );
    return {
      id: row.id,
      carryingMinor: carrying.toString(),
      revaluedMinor: revalued.toString(),
      differenceMinor: difference.toString(),
      journalId,
    };
  });
}
export async function listSettlements(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT id,provider,settlement_reference AS "settlementReference",settlement_date AS "settlementDate",currency,gross_minor::text AS "grossMinor",fee_minor::text AS "feeMinor",net_minor::text AS "netMinor",status,mismatch_reason AS "mismatchReason",journal_id AS "journalId" FROM finance_payment_settlement WHERE organization_id=${ctx.organizationId} ORDER BY settlement_date DESC`,
  );
}
export async function listFxRevaluations(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT id,currency,as_of_date AS "asOfDate",rate_bps AS "rateBps",carrying_minor::text AS "carryingMinor",revalued_minor::text AS "revaluedMinor",difference_minor::text AS "differenceMinor",journal_id AS "journalId" FROM finance_payment_fx_revaluation WHERE organization_id=${ctx.organizationId} ORDER BY as_of_date DESC`,
  );
}
export async function listFxRates(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT id,base_currency AS "baseCurrency",quote_currency AS "quoteCurrency",rate_bps AS "rateBps",effective_at AS "effectiveAt",source FROM finance_payment_fx_rate WHERE organization_id=${ctx.organizationId} ORDER BY effective_at DESC`,
  );
}
export async function listExceptions(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT id,exception_type AS "exceptionType",status,reason,payload,receipt_id AS "receiptId",statement_line_id AS "statementLineId",resolution,created_at AS "createdAt" FROM finance_payment_exception WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC`,
  );
}
export async function resolveException(
  ctx: RequestContext,
  id: string,
  input: ExceptionResolutionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`UPDATE finance_payment_exception SET status=${input.status},resolution=${input.resolution},resolved_by=CASE WHEN ${input.status} IN ('resolved','ignored') THEN ${ctx.principal.id}::uuid ELSE NULL END,resolved_at=CASE WHEN ${input.status} IN ('resolved','ignored') THEN now() ELSE NULL END WHERE organization_id=${ctx.organizationId} AND id=${id} RETURNING id`,
    );
    await audit(
      ctx,
      'payments.exception.updated',
      row.id,
      { status: input.status, resolution: input.resolution },
      input.resolution,
      tx,
    );
    return row;
  });
}
export { hyperswitchAdapter };
