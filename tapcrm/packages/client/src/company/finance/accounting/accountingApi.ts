import { identityDownload, identityRequest } from '../../../identity/api/authApi.js';

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  accountType: string;
  parentAccountId: string | null;
  normalBalance: 'debit' | 'credit';
  systemKey: string | null;
  isSystemAccount: boolean;
  isActive: boolean;
}
export interface AccountingPeriod {
  id: string;
  financialYear: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  bankReconciled: boolean;
  agingReconciled: boolean;
  payablesReconciled: boolean;
  gstReconciled: boolean;
  trialBalanceReconciled: boolean;
}
export interface JournalLine {
  id?: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  debit: string;
  credit: string;
  description?: string | null;
}
export interface JournalEntry {
  id: string;
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  postedAt: string;
  debitTotal: string;
  creditTotal: string;
  lines: JournalLine[];
}
export interface AccountReportRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  balance: string;
  debit?: string;
  credit?: string;
  comparativeBalance?: string;
  variance?: string;
}
export interface Artifact {
  id: string;
  kind: string;
  filename: string;
  periodStart: string;
  periodEnd: string;
  sizeBytes: number;
  rowCount: number;
  createdAt: string;
  metadata: Record<string, unknown>;
  importId?: string;
}
export interface Gstr2bImportResult {
  artifact: Artifact;
  importId: string;
  rowCount: number;
}

const request = <T>(path: string, init?: RequestInit): Promise<T> =>
  identityRequest<T>(path, init);
const query = (values: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
};
const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export function listAccounts(
  status: 'active' | 'inactive' | 'all' = 'active',
): Promise<{ accounts: LedgerAccount[] }> {
  return request(`/api/accounting/accounts?status=${status}`);
}
export function createAccount(
  input: Omit<
    LedgerAccount,
    'id' | 'isSystemAccount' | 'isActive' | 'systemKey' | 'parentAccountId'
  > & { parentAccountId?: string | null },
): Promise<LedgerAccount> {
  return request('/api/accounting/accounts', json('POST', input));
}
export function updateAccount(
  id: string,
  input: { name?: string; parentAccountId?: string | null; isActive?: boolean },
): Promise<LedgerAccount> {
  return request(`/api/accounting/accounts/${id}`, json('PATCH', input));
}
export function listPeriods(
  status: 'open' | 'closing' | 'closed' | 'reopened' | 'all' = 'all',
): Promise<{ periods: AccountingPeriod[] }> {
  return request(`/api/accounting/periods?status=${status}`);
}
export function createPeriod(input: {
  financialYear: string;
  periodStart: string;
  periodEnd: string;
}): Promise<AccountingPeriod> {
  return request('/api/accounting/periods', json('POST', input));
}
export function updateChecklist(
  id: string,
  input: Record<string, boolean>,
): Promise<AccountingPeriod> {
  return request(`/api/accounting/periods/${id}/checklist`, json('POST', input));
}
export function closePeriod(id: string): Promise<AccountingPeriod> {
  return request(`/api/accounting/periods/${id}/close`, json('POST', {}));
}
export function reopenPeriod(id: string, reason: string): Promise<AccountingPeriod> {
  return request(`/api/accounting/periods/${id}/reopen`, json('POST', { reason }));
}
export function listJournals(values: {
  periodId?: string;
  from?: string;
  to?: string;
}): Promise<{ journals: JournalEntry[] }> {
  return request(`/api/accounting/journals${query(values)}`);
}
export function createJournal(input: unknown): Promise<JournalEntry> {
  return request('/api/accounting/journals', json('POST', input));
}
export function reverseJournal(
  id: string,
  entryDate: string,
  reason: string,
): Promise<JournalEntry> {
  return request(
    `/api/accounting/journals/${id}/reverse`,
    json('POST', { entryDate, reason }),
  );
}
export function getTrialBalance(values: {
  periodId?: string;
  from?: string;
  to?: string;
  comparePeriodId?: string | undefined;
}): Promise<{
  rows: AccountReportRow[];
  totals: { debit: string; credit: string; balance: string };
  balanced: boolean;
  from: string;
  to: string;
}> {
  return request(`/api/accounting/reports/trial-balance${query(values)}`);
}
export function getGeneralLedger(values: {
  periodId?: string;
  from?: string;
  to?: string;
  accountId?: string;
}): Promise<{
  entries: Array<JournalEntry & JournalLine & { runningBalance: string }>;
  window: { from: string; to: string };
}> {
  return request(`/api/accounting/general-ledger${query(values)}`);
}
export function getProfitAndLoss(values: {
  periodId?: string;
  from?: string;
  to?: string;
  comparePeriodId?: string | undefined;
}): Promise<{
  revenue: AccountReportRow[];
  expenses: AccountReportRow[];
  revenueTotal: string;
  expenseTotal: string;
  netProfit: string;
  from: string;
  to: string;
}> {
  return request(`/api/accounting/reports/pnl${query(values)}`);
}
export function getBalanceSheet(values: {
  periodId?: string;
  from?: string;
  to?: string;
  comparePeriodId?: string | undefined;
}): Promise<{
  assets: AccountReportRow[];
  liabilities: AccountReportRow[];
  equity: AccountReportRow[];
  totals: { assets: string; liabilities: string; equity: string };
  balanced: boolean;
  asOf: string;
}> {
  return request(`/api/accounting/reports/balance-sheet${query(values)}`);
}
export function getCashFlow(values: {
  periodId?: string;
  from?: string;
  to?: string;
  comparePeriodId?: string | undefined;
}): Promise<{
  sections: Record<string, string>;
  openingCash: string;
  netChange: string;
  closingCash: string;
  from: string;
  to: string;
}> {
  return request(`/api/accounting/reports/cash-flow${query(values)}`);
}
export function exportTax(
  kind: 'gstr1' | 'gstr3b' | 'tds' | 'tds-receivable/reconciliation',
  values: { periodId?: string; from?: string; to?: string },
): Promise<Artifact> {
  return request(`/api/accounting/tax/${kind}${query(values)}`, json('POST', {}));
}
export function importGstr2b(input: {
  filename: string;
  periodStart: string;
  periodEnd: string;
  contentBase64: string;
}): Promise<Gstr2bImportResult> {
  return request('/api/accounting/tax/gstr2b/import', json('POST', input));
}
export function reconcileGstr2b(id: string): Promise<{
  importId: string;
  importedTax: string;
  ledgerInputTax: string;
  variance: string;
  status: string;
}> {
  return request(`/api/accounting/tax/gstr2b/${id}/reconciliation`);
}
export function listArtifacts(): Promise<{ artifacts: Artifact[] }> {
  return request('/api/accounting/tax/artifacts');
}
export function downloadArtifact(id: string): Promise<Blob> {
  return identityDownload(`/api/accounting/tax/artifacts/${id}/download`);
}
export function downloadAccountingReport(
  kind: 'general-ledger' | 'trial-balance' | 'pnl' | 'balance-sheet' | 'cash-flow',
  values: { periodId?: string; accountId?: string },
): Promise<Blob> {
  const path =
    kind === 'general-ledger'
      ? `/api/accounting/general-ledger/export${query(values)}`
      : kind === 'trial-balance'
        ? `/api/accounting/trial-balance/export${query(values)}`
        : `/api/accounting/reports/${kind}/export${query(values)}`;
  return identityDownload(path);
}
