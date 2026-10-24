import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { Decimal } from '@tapcrm/contracts';
import { postJournalTx } from './ledger.js';

/**
 * Cross-module accounting boundary.
 *
 * Source modules own the transaction. This façade only resolves the tenant's
 * system accounts and posts through the supplied transaction; it never starts
 * a nested transaction and never performs external I/O.
 */
export interface AccountingPostingLine {
  readonly accountKey: string;
  readonly amountPaise: bigint;
  readonly side: 'debit' | 'credit';
  readonly description?: string | null;
}

export interface AccountingPostingInput {
  readonly organizationId: string;
  readonly postedBy: string;
  readonly entryDate: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly description: string;
  readonly reason?: string | null;
  readonly lines: readonly AccountingPostingLine[];
}

export interface AccountingPostingResult {
  readonly journalId: string | null;
  readonly duplicate: boolean;
}

function paiseToDecimal(amountPaise: bigint): Decimal {
  if (amountPaise <= 0n) throw new Error('ACCOUNTING_NONPOSITIVE_LINE');
  const whole = amountPaise / 100n;
  const fraction = (amountPaise % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}` as Decimal;
}

function validateInput(input: AccountingPostingInput): void {
  if (!input.sourceId) throw new Error('ACCOUNTING_SOURCE_ID_REQUIRED');
  if (!input.sourceType.trim()) throw new Error('ACCOUNTING_SOURCE_TYPE_REQUIRED');
  if (input.lines.length < 2) throw new Error('ACCOUNTING_JOURNAL_EMPTY');

  let debit = 0n;
  let credit = 0n;
  for (const line of input.lines) {
    if (!line.accountKey.trim()) throw new Error('ACCOUNTING_ACCOUNT_KEY_REQUIRED');
    if (line.amountPaise <= 0n) throw new Error('ACCOUNTING_NONPOSITIVE_LINE');
    if (line.side === 'debit') debit += line.amountPaise;
    else credit += line.amountPaise;
  }
  if (debit !== credit)
    throw new Error(`ACCOUNTING_UNBALANCED: debit ${debit} != credit ${credit}`);
}

/**
 * Posts one source event atomically with the caller's work.
 *
 * The source uniqueness lookup makes a retried source operation safe: a
 * source event can have at most one journal. The unique database index is the
 * final concurrency guard.
 */
export async function postSourceJournalTx(
  tx: Tx,
  input: AccountingPostingInput,
): Promise<AccountingPostingResult> {
  validateInput(input);

  const existing = await tx.maybeOne<{ id: string }>(sql`
    SELECT id
    FROM journal_entry
    WHERE organization_id = ${input.organizationId}
      AND source_type = ${input.sourceType}
      AND source_id = ${input.sourceId}::uuid
  `);
  if (existing) return { journalId: existing.id, duplicate: true };

  const accountKeys = [...new Set(input.lines.map((line) => line.accountKey))];
  const accounts = await tx.query<{ id: string; systemKey: string }>(sql`
    SELECT id, system_key AS "systemKey"
    FROM ledger_account
    WHERE organization_id = ${input.organizationId}
      AND system_key = ANY(${accountKeys}::text[])
      AND is_active = true
  `);
  const accountIds = new Map(accounts.map((account) => [account.systemKey, account.id]));
  if (accountIds.size !== accountKeys.length) {
    const missing = accountKeys.find((key) => !accountIds.has(key));
    throw new Error(`ACCOUNTING_SYSTEM_ACCOUNT_NOT_FOUND: ${missing}`);
  }

  const result = await postJournalTx(tx, {
    organizationId: input.organizationId,
    postedBy: input.postedBy,
    journal: {
      entryDate: input.entryDate,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reason: input.reason,
      lines: input.lines.map((line) => ({
        accountId: accountIds.get(line.accountKey)!,
        debit:
          line.side === 'debit' ? paiseToDecimal(line.amountPaise) : ('0.00' as Decimal),
        credit:
          line.side === 'credit' ? paiseToDecimal(line.amountPaise) : ('0.00' as Decimal),
        description: line.description ?? null,
      })),
    },
  });

  return { journalId: result.id, duplicate: false };
}
