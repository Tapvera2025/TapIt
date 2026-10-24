import type { Tx } from '../../../platform/dal/db.js';
import { AccountingNotFoundError, AccountingValidationError, ACCOUNTING_ERROR_CODES } from './errors.js';
import { assertActiveAccounts, findJournalForUpdate, hasReversal, insertJournalHeader, insertJournalLines, lockPostingPeriod, markPeriodPosted } from './repository.js';
import type { CreateJournalInput, JournalLineInput, ReverseJournalInput } from './types.js';

function cents(value: string): bigint {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new AccountingValidationError('Journal amounts must be non-negative decimals with at most 2 fractional digits.', ACCOUNTING_ERROR_CODES.JOURNAL_UNBALANCED);
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

function validateLines(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) throw new AccountingValidationError('A journal must contain at least two lines.', ACCOUNTING_ERROR_CODES.JOURNAL_EMPTY);
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    const d = cents(line.debit);
    const c = cents(line.credit);
    if ((d > 0n && c > 0n) || (d === 0n && c === 0n)) {
      throw new AccountingValidationError('Each journal line must contain either a debit or a credit, but not both.', ACCOUNTING_ERROR_CODES.JOURNAL_UNBALANCED);
    }
    debit += d;
    credit += c;
  }
  if (debit !== credit) {
    throw new AccountingValidationError('Journal debits and credits must balance exactly.', ACCOUNTING_ERROR_CODES.JOURNAL_UNBALANCED);
  }
}

export async function postJournalTx(tx: Tx, input: {
  organizationId: string;
  postedBy: string;
  journal: CreateJournalInput;
}): Promise<{ id: string }> {
  validateLines(input.journal.lines);
  const accountIds = input.journal.lines.map((line) => line.accountId);
  await assertActiveAccounts(tx, input.organizationId, accountIds);
  const period = await lockPostingPeriod(tx, input.organizationId, input.journal.entryDate);
  if (!period) throw new AccountingNotFoundError('No accounting period covers the journal entry date.', ACCOUNTING_ERROR_CODES.PERIOD_NOT_FOUND);
  if (!['open', 'reopened'].includes(period.status)) {
    throw new AccountingValidationError('The accounting period is closed and cannot accept postings.', ACCOUNTING_ERROR_CODES.PERIOD_CLOSED);
  }
  const header = await insertJournalHeader(tx, input.organizationId, input.postedBy, input.journal, period.id);
  await insertJournalLines(tx, input.organizationId, header.id, input.journal.lines);
  await markPeriodPosted(tx, input.organizationId, period.id, input.postedBy);
  return header;
}

export async function reverseJournalTx(tx: Tx, input: {
  organizationId: string;
  postedBy: string;
  journalId: string;
  reversal: ReverseJournalInput;
}): Promise<{ id: string }> {
  const original = await findJournalForUpdate(tx, input.organizationId, input.journalId);
  if (!original) throw new AccountingNotFoundError('Journal entry not found.', ACCOUNTING_ERROR_CODES.JOURNAL_NOT_FOUND);
  if (original.reversalOfId) throw new AccountingValidationError('A reversal journal cannot itself be reversed.', ACCOUNTING_ERROR_CODES.JOURNAL_ALREADY_REVERSED);
  if (await hasReversal(tx, input.organizationId, original.id)) {
    throw new AccountingValidationError('This journal entry has already been reversed.', ACCOUNTING_ERROR_CODES.JOURNAL_ALREADY_REVERSED);
  }

  const journal: CreateJournalInput = {
    entryDate: input.reversal.entryDate,
    description: `Reversal: ${original.description}`,
    sourceType: 'reversal',
    sourceId: original.id,
    reason: input.reversal.reason,
    reversalOfId: original.id,
    lines: original.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.credit as JournalLineInput['debit'],
      credit: line.debit as JournalLineInput['credit'],
      description: line.description,
    })),
  };
  const result = await postJournalTx(tx, { organizationId: input.organizationId, postedBy: input.postedBy, journal });
  return result;
}

