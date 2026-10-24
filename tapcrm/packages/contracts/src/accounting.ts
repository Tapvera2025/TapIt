import type { Decimal } from './money.js';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountingAccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_NORMAL_BALANCES = ['debit', 'credit'] as const;
export type AccountNormalBalance = (typeof ACCOUNT_NORMAL_BALANCES)[number];
export const ACCOUNTING_PERIOD_STATUSES = ['open', 'closing', 'closed', 'reopened'] as const;
export type AccountingPeriodStatus = (typeof ACCOUNTING_PERIOD_STATUSES)[number];

export interface LedgerAccount {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly accountType: AccountingAccountType;
  readonly parentAccountId: string | null;
  readonly normalBalance: AccountNormalBalance;
  readonly systemKey: string | null;
  readonly isSystemAccount: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AccountingPeriod {
  readonly id: string;
  readonly organizationId: string;
  readonly financialYear: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: AccountingPeriodStatus;
  readonly closedBy: string | null;
  readonly closedAt: Date | null;
  readonly reopenedBy: string | null;
  readonly reopenedAt: Date | null;
  readonly reopenReason: string | null;
  readonly lastPostedBy: string | null;
  readonly lastPostedAt: Date | null;
  readonly bankReconciled: boolean;
  readonly agingReconciled: boolean;
  readonly payablesReconciled: boolean;
  readonly gstReconciled: boolean;
  readonly trialBalanceReconciled: boolean;
  readonly checklistUpdatedBy: string | null;
  readonly checklistUpdatedAt: Date | null;
}

export interface AccountingAccountBalance {
  readonly accountId: string;
  readonly debit: Decimal;
  readonly credit: Decimal;
  readonly balance: Decimal;
}
