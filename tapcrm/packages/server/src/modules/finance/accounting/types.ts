import type { AccountingPeriod, AccountingPeriodStatus, AccountingAccountType, AccountNormalBalance, LedgerAccount, Decimal, JournalEntry } from '@tapcrm/contracts';

export type { AccountingPeriod, AccountingPeriodStatus, AccountingAccountType, AccountNormalBalance, LedgerAccount };

export interface CreateLedgerAccountInput {
  readonly code: string;
  readonly name: string;
  readonly accountType: AccountingAccountType;
  readonly parentAccountId?: string | null | undefined;
  readonly normalBalance: AccountNormalBalance;
}

export interface UpdateLedgerAccountInput {
  readonly name?: string | undefined;
  readonly parentAccountId?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

export interface AccountingPeriodQuery {
  readonly status?: AccountingPeriodStatus | 'all';
}

export interface CreateAccountingPeriodInput {
  readonly financialYear: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface AccountingCloseChecklistInput {
  readonly bankReconciled: boolean;
  readonly agingReconciled: boolean;
  readonly payablesReconciled: boolean;
  readonly gstReconciled: boolean;
  readonly trialBalanceReconciled: boolean;
}

export interface JournalLineInput {
  readonly accountId: string;
  readonly debit: Decimal;
  readonly credit: Decimal;
  readonly description?: string | null | undefined;
}

export interface CreateJournalInput {
  readonly entryDate: string;
  readonly description: string;
  readonly sourceType: string;
  readonly sourceId?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly reversalOfId?: string | null | undefined;
  readonly lines: readonly JournalLineInput[];
}

export interface ReverseJournalInput {
  readonly entryDate: string;
  readonly reason: string;
}

export interface JournalQuery {
  readonly periodId?: string | undefined;
  readonly accountId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export type JournalEntryResult = JournalEntry;
