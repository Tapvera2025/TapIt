import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { AccountingCloseChecklistInput, AccountingPeriod, AccountingPeriodQuery, CreateAccountingPeriodInput, CreateLedgerAccountInput, CreateJournalInput, JournalEntryResult, JournalQuery, LedgerAccount, UpdateLedgerAccountInput } from './types.js';
import type { Decimal } from '@tapcrm/contracts';

export async function findLedgerAccount(ctx: RequestContext, id: string): Promise<LedgerAccount | null> {
  return db.maybeOne<LedgerAccount>(ctx, sql`
    SELECT id, organization_id AS "organizationId", code, name, account_type AS "accountType",
           parent_account_id AS "parentAccountId", normal_balance AS "normalBalance",
           system_key AS "systemKey", is_system_account AS "isSystemAccount", is_active AS "isActive",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM ledger_account
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
}

export async function listLedgerAccounts(ctx: RequestContext, filter: SqlFragment, status: string): Promise<LedgerAccount[]> {
  const statusClause = status === 'all' ? sql`` : sql`AND la.is_active = ${status === 'active'}`;
  return db.query<LedgerAccount>(ctx, sql`
    SELECT la.id, la.organization_id AS "organizationId", la.code, la.name, la.account_type AS "accountType",
           la.parent_account_id AS "parentAccountId", la.normal_balance AS "normalBalance",
           la.system_key AS "systemKey", la.is_system_account AS "isSystemAccount", la.is_active AS "isActive",
           la.created_at AS "createdAt", la.updated_at AS "updatedAt"
    FROM ledger_account la
    WHERE la.organization_id = ${ctx.organizationId} AND (${filter}) ${statusClause}
    ORDER BY la.code
  `);
}

export async function insertLedgerAccount(tx: Tx, organizationId: string, input: CreateLedgerAccountInput): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO ledger_account (organization_id, code, name, account_type, parent_account_id, normal_balance)
    VALUES (${organizationId}, ${input.code}, ${input.name}, ${input.accountType}, ${input.parentAccountId ?? null}, ${input.normalBalance})
    RETURNING id
  `);
}

export async function updateLedgerAccount(tx: Tx, organizationId: string, id: string, input: UpdateLedgerAccountInput): Promise<void> {
  await tx.query(sql`
    UPDATE ledger_account
    SET name = COALESCE(${input.name ?? null}, name),
        parent_account_id = CASE WHEN ${input.parentAccountId !== undefined} THEN ${input.parentAccountId ?? null} ELSE parent_account_id END,
        is_active = COALESCE(${input.isActive ?? null}, is_active),
        updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
}

export async function findAccountingPeriod(ctx: RequestContext, id: string): Promise<AccountingPeriod | null> {
  return db.maybeOne<AccountingPeriod>(ctx, sql`
    SELECT id, organization_id AS "organizationId", financial_year AS "financialYear",
           period_start::text AS "periodStart", period_end::text AS "periodEnd", status,
           closed_by AS "closedBy", closed_at AS "closedAt", reopened_by AS "reopenedBy",
           reopened_at AS "reopenedAt", reopen_reason AS "reopenReason",
           last_posted_by AS "lastPostedBy", last_posted_at AS "lastPostedAt",
           bank_reconciled AS "bankReconciled", aging_reconciled AS "agingReconciled",
           payables_reconciled AS "payablesReconciled", gst_reconciled AS "gstReconciled",
           trial_balance_reconciled AS "trialBalanceReconciled",
           checklist_updated_by AS "checklistUpdatedBy", checklist_updated_at AS "checklistUpdatedAt"
    FROM accounting_period
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
}

export async function listAccountingPeriods(ctx: RequestContext, query: AccountingPeriodQuery): Promise<AccountingPeriod[]> {
  const statusClause = !query.status || query.status === 'all' ? sql`` : sql`AND status = ${query.status}`;
  return db.query<AccountingPeriod>(ctx, sql`
    SELECT id, organization_id AS "organizationId", financial_year AS "financialYear",
           period_start::text AS "periodStart", period_end::text AS "periodEnd", status,
           closed_by AS "closedBy", closed_at AS "closedAt", reopened_by AS "reopenedBy",
           reopened_at AS "reopenedAt", reopen_reason AS "reopenReason",
           last_posted_by AS "lastPostedBy", last_posted_at AS "lastPostedAt",
           bank_reconciled AS "bankReconciled", aging_reconciled AS "agingReconciled",
           payables_reconciled AS "payablesReconciled", gst_reconciled AS "gstReconciled",
           trial_balance_reconciled AS "trialBalanceReconciled",
           checklist_updated_by AS "checklistUpdatedBy", checklist_updated_at AS "checklistUpdatedAt"
    FROM accounting_period
    WHERE organization_id = ${ctx.organizationId} ${statusClause}
    ORDER BY period_start DESC
  `);
}

export async function closeAccountingPeriod(tx: Tx, organizationId: string, id: string, actorId: string): Promise<void> {
  await tx.query(sql`
    UPDATE accounting_period
    SET status = 'closed', closed_by = ${actorId}, closed_at = now(), updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id} AND status IN ('open', 'reopened')
  `);
}

export async function insertAccountingPeriod(tx: Tx, organizationId: string, input: CreateAccountingPeriodInput): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO accounting_period (organization_id, financial_year, period_start, period_end)
    VALUES (${organizationId}, ${input.financialYear}, ${input.periodStart}, ${input.periodEnd})
    RETURNING id
  `);
}

export async function updateCloseChecklist(tx: Tx, organizationId: string, id: string, actorId: string, input: AccountingCloseChecklistInput): Promise<void> {
  await tx.query(sql`
    UPDATE accounting_period
    SET bank_reconciled = ${input.bankReconciled},
        aging_reconciled = ${input.agingReconciled},
        payables_reconciled = ${input.payablesReconciled},
        gst_reconciled = ${input.gstReconciled},
        trial_balance_reconciled = ${input.trialBalanceReconciled},
        checklist_updated_by = ${actorId}, checklist_updated_at = now(), updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id} AND status IN ('open', 'reopened')
  `);
}

export async function lockPeriodForClose(tx: Tx, organizationId: string, id: string): Promise<{ status: string; bankReconciled: boolean; agingReconciled: boolean; payablesReconciled: boolean; gstReconciled: boolean; trialBalanceReconciled: boolean } | null> {
  return tx.maybeOne(sql`
    SELECT status, bank_reconciled AS "bankReconciled", aging_reconciled AS "agingReconciled",
           payables_reconciled AS "payablesReconciled", gst_reconciled AS "gstReconciled",
           trial_balance_reconciled AS "trialBalanceReconciled"
    FROM accounting_period
    WHERE organization_id = ${organizationId} AND id = ${id}
    FOR UPDATE
  `);
}

export async function periodHasPostingBy(tx: Tx, organizationId: string, periodId: string, actorId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM journal_entry
    WHERE organization_id = ${organizationId} AND period_id = ${periodId} AND posted_by = ${actorId}
    LIMIT 1
  `);
  return row !== null;
}

export async function periodDatesOverlap(tx: Tx, organizationId: string, periodStart: string, periodEnd: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM accounting_period
    WHERE organization_id = ${organizationId}
      AND daterange(period_start, period_end, '[]') && daterange(${periodStart}::date, ${periodEnd}::date, '[]')
    LIMIT 1
  `);
  return row !== null;
}

export async function reopenAccountingPeriod(tx: Tx, organizationId: string, id: string, actorId: string, reason: string): Promise<void> {
  await tx.query(sql`
    UPDATE accounting_period
    SET status = 'reopened', reopened_by = ${actorId}, reopened_at = now(), reopen_reason = ${reason}, updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'closed'
  `);
}

interface JournalHeaderRow {
  id: string;
  organizationId: string;
  periodId: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  reason: string | null;
  postedBy: string;
  postedAt: Date;
  reversalOfId: string | null;
  debitTotal: string;
  creditTotal: string;
}

interface JournalLineRow {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  description: string | null;
}

function hydrateJournal(header: JournalHeaderRow, lines: JournalLineRow[]): JournalEntryResult {
  return {
    ...header,
    debitTotal: header.debitTotal as Decimal,
    creditTotal: header.creditTotal as Decimal,
    lines: lines.map((line) => ({
      ...line,
      debit: line.debit as Decimal,
      credit: line.credit as Decimal,
    })),
  };
}

const JOURNAL_HEADER_COLUMNS = sql.raw(`
  je.id, je.organization_id AS "organizationId", je.period_id AS "periodId",
  je.entry_date::text AS "entryDate", je.description, je.source_type AS "sourceType",
  je.source_id AS "sourceId", je.reason, je.posted_by AS "postedBy",
  je.posted_at AS "postedAt", je.reversal_of_id AS "reversalOfId",
  COALESCE(SUM(jl.debit), 0)::text AS "debitTotal",
  COALESCE(SUM(jl.credit), 0)::text AS "creditTotal"
`);

async function findJournalHeaders(ctx: RequestContext, where: ReturnType<typeof sql>, order = 'je.entry_date DESC, je.posted_at DESC'): Promise<JournalHeaderRow[]> {
  return db.query<JournalHeaderRow>(ctx, sql`
    SELECT ${JOURNAL_HEADER_COLUMNS}
    FROM journal_entry je
    LEFT JOIN journal_line jl ON jl.organization_id = je.organization_id AND jl.journal_entry_id = je.id
    WHERE je.organization_id = ${ctx.organizationId} ${where}
    GROUP BY je.id
    ORDER BY ${sql.raw(order)}
  `);
}

async function findJournalLines(ctx: RequestContext, journalId: string): Promise<JournalLineRow[]> {
  return db.query<JournalLineRow>(ctx, sql`
    SELECT id, ledger_account_id AS "accountId", debit::text AS debit, credit::text AS credit, description
    FROM journal_line
    WHERE organization_id = ${ctx.organizationId} AND journal_entry_id = ${journalId}
    ORDER BY id
  `);
}

export async function findJournalEntry(ctx: RequestContext, id: string): Promise<JournalEntryResult | null> {
  const rows = await findJournalHeaders(ctx, sql`AND je.id = ${id}`);
  if (!rows[0]) return null;
  return hydrateJournal(rows[0], await findJournalLines(ctx, id));
}

export async function listJournalEntries(ctx: RequestContext, query: JournalQuery, filter: SqlFragment): Promise<JournalEntryResult[]> {
  const filters = [
    query.periodId ? sql`AND je.period_id = ${query.periodId}` : sql``,
    query.accountId ? sql`AND EXISTS (SELECT 1 FROM journal_line filter_line WHERE filter_line.organization_id = je.organization_id AND filter_line.journal_entry_id = je.id AND filter_line.ledger_account_id = ${query.accountId})` : sql``,
    query.from ? sql`AND je.entry_date >= ${query.from}::date` : sql``,
    query.to ? sql`AND je.entry_date <= ${query.to}::date` : sql``,
  ];
  const headers = await findJournalHeaders(ctx, sql`AND (${filter})${filters[0]}${filters[1]}${filters[2]}${filters[3]}`);
  const lines = await Promise.all(headers.map((header) => findJournalLines(ctx, header.id)));
  return headers.map((header, index) => hydrateJournal(header, lines[index] ?? []));
}

export async function insertJournalHeader(tx: Tx, organizationId: string, postedBy: string, input: CreateJournalInput, periodId: string): Promise<{ id: string }> {
  return tx.one<{ id: string }>(sql`
    INSERT INTO journal_entry (organization_id, period_id, entry_date, description, source_type, source_id, reason, posted_by, reversal_of_id)
    VALUES (${organizationId}, ${periodId}, ${input.entryDate}, ${input.description}, ${input.sourceType}, ${input.sourceId ?? null}, ${input.reason ?? null}, ${postedBy}, ${input.reversalOfId ?? null})
    RETURNING id
  `);
}

export async function insertJournalLines(tx: Tx, organizationId: string, journalId: string, lines: CreateJournalInput['lines']): Promise<void> {
  for (const line of lines) {
    await tx.query(sql`
      INSERT INTO journal_line (organization_id, journal_entry_id, ledger_account_id, debit, credit, description)
      VALUES (${organizationId}, ${journalId}, ${line.accountId}, ${line.debit}, ${line.credit}, ${line.description ?? null})
    `);
  }
}

export async function lockPostingPeriod(tx: Tx, organizationId: string, entryDate: string): Promise<{ id: string; status: string } | null> {
  return tx.maybeOne<{ id: string; status: string }>(sql`
    SELECT id, status
    FROM accounting_period
    WHERE organization_id = ${organizationId}
      AND period_start <= ${entryDate}::date
      AND period_end >= ${entryDate}::date
    FOR UPDATE
  `);
}

export async function assertActiveAccounts(tx: Tx, organizationId: string, accountIds: readonly string[]): Promise<void> {
  const row = await tx.one<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM ledger_account
    WHERE organization_id = ${organizationId}
      AND id = ANY(${accountIds}::uuid[])
      AND is_active = true
  `);
  if (Number(row.count) !== new Set(accountIds).size) {
    throw new Error('ACCOUNTING_ACCOUNT_NOT_FOUND_OR_INACTIVE');
  }
}

export async function markPeriodPosted(tx: Tx, organizationId: string, periodId: string, actorId: string): Promise<void> {
  await tx.query(sql`
    UPDATE accounting_period
    SET last_posted_by = ${actorId}, last_posted_at = now(), updated_at = now()
    WHERE organization_id = ${organizationId} AND id = ${periodId}
  `);
}

export async function findJournalForUpdate(tx: Tx, organizationId: string, id: string): Promise<(JournalHeaderRow & { lines: JournalLineRow[] }) | null> {
  const header = await tx.maybeOne<JournalHeaderRow>(sql`
    SELECT id, organization_id AS "organizationId", period_id AS "periodId",
           entry_date::text AS "entryDate", description, source_type AS "sourceType",
           source_id AS "sourceId", reason, posted_by AS "postedBy",
           posted_at AS "postedAt", reversal_of_id AS "reversalOfId",
           '0'::text AS "debitTotal", '0'::text AS "creditTotal"
    FROM journal_entry
    WHERE organization_id = ${organizationId} AND id = ${id}
  `);
  if (!header) return null;
  const totals = await tx.one<{ debitTotal: string; creditTotal: string }>(sql`
    SELECT COALESCE(SUM(debit), 0)::text AS "debitTotal", COALESCE(SUM(credit), 0)::text AS "creditTotal"
    FROM journal_line
    WHERE organization_id = ${organizationId} AND journal_entry_id = ${id}
  `);
  const lines = await tx.query<JournalLineRow>(sql`
    SELECT id, ledger_account_id AS "accountId", debit::text AS debit, credit::text AS credit, description
    FROM journal_line
    WHERE organization_id = ${organizationId} AND journal_entry_id = ${id}
    ORDER BY id
  `);
  return { ...header, ...totals, lines };
}

export async function hasReversal(tx: Tx, organizationId: string, journalId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM journal_entry
    WHERE organization_id = ${organizationId} AND reversal_of_id = ${journalId}
    LIMIT 1
  `);
  return row !== null;
}

export async function listAccountBalances(ctx: RequestContext, periodId: string | undefined, accountId: string | undefined, filter: SqlFragment) {
  const periodClause = periodId ? sql`AND ab.period_id = ${periodId}` : sql``;
  const accountClause = accountId ? sql`AND ab.ledger_account_id = ${accountId}` : sql``;
  return db.query<{
    accountId: string;
    periodId: string;
    debit: string;
    credit: string;
    balance: string;
  }>(ctx, sql`
    SELECT ledger_account_id AS "accountId", period_id AS "periodId",
           debit_total::text AS debit, credit_total::text AS credit, balance::text
    FROM account_balance ab
    WHERE organization_id = ${ctx.organizationId} AND (${filter}) ${periodClause}${accountClause}
    ORDER BY period_id, ledger_account_id
  `);
}
