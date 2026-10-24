import { visibilityFilter, type Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { AccountingNotFoundError, AccountingValidationError, ACCOUNTING_ERROR_CODES } from './errors.js';
import { closeAccountingPeriod, findAccountingPeriod, findLedgerAccount, insertAccountingPeriod, insertLedgerAccount, listAccountingPeriods, listLedgerAccounts, lockPeriodForClose, periodDatesOverlap, periodHasPostingBy, reopenAccountingPeriod, updateCloseChecklist, updateLedgerAccount } from './repository.js';
import { findJournalEntry, listAccountBalances, listJournalEntries } from './repository.js';
import type { AccountingCloseChecklistInput, AccountingPeriodQuery, CreateAccountingPeriodInput, CreateJournalInput, CreateLedgerAccountInput, JournalQuery, ReverseJournalInput, UpdateLedgerAccountInput } from './types.js';
import { postJournalTx, reverseJournalTx } from './ledger.js';

export async function loadLedgerAccountResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await findLedgerAccount(ctx, id);
  return row ? { type: 'ledgerAccount', id: row.id, organizationId: row.organizationId } : null;
}

export async function loadAccountingPeriodResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await findAccountingPeriod(ctx, id);
  return row ? { type: 'accountingPeriod', id: row.id, organizationId: row.organizationId, lastPostedBy: row.lastPostedBy } : null;
}

export async function listAccounts(ctx: RequestContext, status: string) {
  const filter = await visibilityFilter(ctx, 'accounting:view-ledger', 'ledgerAccount');
  return { accounts: await listLedgerAccounts(ctx, filter, status) };
}

export async function createAccount(ctx: RequestContext, input: CreateLedgerAccountInput) {
  const created = await db.transaction(ctx, (tx) => insertLedgerAccount(tx, ctx.organizationId, input));
  const account = await findLedgerAccount(ctx, created.id);
  if (!account) throw new AccountingNotFoundError('The account was created but could not be loaded.', ACCOUNTING_ERROR_CODES.ACCOUNT_NOT_FOUND);
  return account;
}

export async function updateAccount(ctx: RequestContext, id: string, input: UpdateLedgerAccountInput) {
  const current = await findLedgerAccount(ctx, id);
  if (!current) throw new AccountingNotFoundError('Ledger account not found.', ACCOUNTING_ERROR_CODES.ACCOUNT_NOT_FOUND);
  if (current.isSystemAccount && input.isActive === false) {
    throw new AccountingValidationError('System accounts cannot be deactivated.', ACCOUNTING_ERROR_CODES.SYSTEM_ACCOUNT);
  }
  await db.transaction(ctx, (tx) => updateLedgerAccount(tx, ctx.organizationId, id, input));
  const updated = await findLedgerAccount(ctx, id);
  if (!updated) throw new AccountingNotFoundError('Ledger account not found.', ACCOUNTING_ERROR_CODES.ACCOUNT_NOT_FOUND);
  return updated;
}

export async function getPeriods(ctx: RequestContext, query: AccountingPeriodQuery) {
  return { periods: await listAccountingPeriods(ctx, query) };
}

export async function closePeriod(ctx: RequestContext, id: string) {
  const period = await findAccountingPeriod(ctx, id);
  if (!period) throw new AccountingNotFoundError('Accounting period not found.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND);
  await db.transaction(ctx, async (tx) => {
    const locked = await lockPeriodForClose(tx, ctx.organizationId, id);
    if (!locked) throw new AccountingNotFoundError('Accounting period not found.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND);
    if (!['open', 'reopened'].includes(locked.status)) throw new AccountingValidationError('Only an open or reopened period can be closed.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_CLOSABLE);
    if (!locked.bankReconciled || !locked.agingReconciled || !locked.payablesReconciled || !locked.gstReconciled || !locked.trialBalanceReconciled) {
      throw new AccountingValidationError('All close checklist items must be completed before closing the period.', ACCOUNTING_ERROR_CODES.CLOSE_CHECKLIST_INCOMPLETE);
    }
    if (await periodHasPostingBy(tx, ctx.organizationId, id, ctx.principal.id)) {
      throw new AccountingValidationError('The person who posted journal entries in this period cannot close it.', ACCOUNTING_ERROR_CODES.CLOSE_SELF_POSTING);
    }
    await closeAccountingPeriod(tx, ctx.organizationId, id, ctx.principal.id);
  });
  return findAccountingPeriod(ctx, id);
}

export async function createPeriod(ctx: RequestContext, input: CreateAccountingPeriodInput) {
  const start = new Date(`${input.periodStart}T00:00:00Z`);
  const end = new Date(`${input.periodEnd}T00:00:00Z`);
  const expectedEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const startYear = Number(input.financialYear.slice(0, 4));
  const validYear = /^\d{4}-\d{4}$/.test(input.financialYear) && Number(input.financialYear.slice(5)) === startYear + 1;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getUTCDate() !== 1 || end.getTime() !== expectedEnd.getTime() || !validYear || (start.getUTCMonth() <= 2 ? start.getUTCFullYear() !== startYear + 1 : start.getUTCFullYear() !== startYear)) {
    throw new AccountingValidationError('Accounting periods must be complete calendar months within an April-to-March financial year.', ACCOUNTING_ERROR_CODES.INVALID_PERIOD);
  }
  const created = await db.transaction(ctx, async (tx) => {
    if (await periodDatesOverlap(tx, ctx.organizationId, input.periodStart, input.periodEnd)) {
      throw new AccountingValidationError('The accounting period overlaps an existing period.', ACCOUNTING_ERROR_CODES.PERIOD_OVERLAP);
    }
    return insertAccountingPeriod(tx, ctx.organizationId, input);
  });
  const period = await findAccountingPeriod(ctx, created.id);
  if (!period) throw new AccountingNotFoundError('The period was created but could not be loaded.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND);
  return period;
}

export async function updateChecklist(ctx: RequestContext, id: string, input: AccountingCloseChecklistInput) {
  const period = await findAccountingPeriod(ctx, id);
  if (!period) throw new AccountingNotFoundError('Accounting period not found.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND);
  await db.transaction(ctx, (tx) => updateCloseChecklist(tx, ctx.organizationId, id, ctx.principal.id, input));
  return findAccountingPeriod(ctx, id);
}

export async function reopenPeriod(ctx: RequestContext, id: string, reason: string) {
  if (ctx.principal.accountType !== 'super-admin') {
    throw new AccountingValidationError('Only Super Admin can reopen an accounting period.', ACCOUNTING_ERROR_CODES.PERIOD_CLOSED);
  }
  const period = await findAccountingPeriod(ctx, id);
  if (!period) throw new AccountingNotFoundError('Accounting period not found.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND);
  if (period.status !== 'closed') throw new AccountingValidationError('Only a closed period can be reopened.', ACCOUNTING_ERROR_CODES.PERIOD_CLOSED);
  await db.transaction(ctx, (tx) => reopenAccountingPeriod(tx, ctx.organizationId, id, ctx.principal.id, reason));
  return findAccountingPeriod(ctx, id);
}

export async function loadJournalEntryResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await findJournalEntry(ctx, id);
  return row ? { type: 'journalEntry', id: row.id, organizationId: row.organizationId } : null;
}

export async function listJournals(ctx: RequestContext, query: JournalQuery) {
  const filter = await visibilityFilter(ctx, 'accounting:view-ledger', 'journalEntry');
  return { journals: await listJournalEntries(ctx, query, filter) };
}

export async function getAccountBalances(ctx: RequestContext, query: { periodId?: string | undefined; accountId?: string | undefined }) {
  const filter = await visibilityFilter(ctx, 'accounting:view-ledger', 'journalEntry');
  return { balances: await listAccountBalances(ctx, query.periodId, query.accountId, filter) };
}

export async function createJournal(ctx: RequestContext, input: CreateJournalInput) {
  const result = await db.transaction(ctx, (tx) => postJournalTx(tx, {
    organizationId: ctx.organizationId,
    postedBy: ctx.principal.id,
    journal: input,
  }));
  const journal = await findJournalEntry(ctx, result.id);
  if (!journal) throw new AccountingNotFoundError('The journal was posted but could not be loaded.', ACCOUNTING_ERROR_CODES.JOURNAL_NOT_FOUND);
  return journal;
}

export async function reverseJournal(ctx: RequestContext, id: string, input: ReverseJournalInput) {
  const result = await db.transaction(ctx, (tx) => reverseJournalTx(tx, {
    organizationId: ctx.organizationId,
    postedBy: ctx.principal.id,
    journalId: id,
    reversal: input,
  }));
  const journal = await findJournalEntry(ctx, result.id);
  if (!journal) throw new AccountingNotFoundError('The reversal was posted but could not be loaded.', ACCOUNTING_ERROR_CODES.JOURNAL_NOT_FOUND);
  return journal;
}
