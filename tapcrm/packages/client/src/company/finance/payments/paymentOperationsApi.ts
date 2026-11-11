import { identityRequest } from '../../../identity/api/authApi.js';

export interface BankLine {
  id: string;
  importId: string;
  transactionDate: string;
  reference: string | null;
  description: string | null;
  debitMinor: string;
  creditMinor: string;
  currency: string;
  matchedReceiptId: string | null;
}
export interface Receipt {
  id: string;
  provider: string;
  providerEventId: string | null;
  providerPaymentId: string | null;
  bankReference: string | null;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  feeMinor: string;
  cashClassification: string;
  state: string;
  verifiedJournalId: string | null;
  allocatedMinor: string;
  remainingMinor: string;
  settled: boolean;
}
export interface AllocatableInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  total: string;
  outstandingMinor: string;
}
export interface PaymentException {
  id: string;
  exceptionType: string;
  status: string;
  reason: string;
  payload: Record<string, unknown>;
  receiptId: string | null;
  statementLineId: string | null;
  resolution: string | null;
  createdAt: string;
}
export interface Settlement {
  id: string;
  provider: string;
  settlementReference: string;
  settlementDate: string;
  currency: string;
  grossMinor: string;
  feeMinor: string;
  netMinor: string;
  status: string;
  mismatchReason: string | null;
  journalId: string | null;
}
export interface FxRevaluation {
  id: string;
  currency: string;
  asOfDate: string;
  rateBps: number;
  carryingMinor: string;
  revaluedMinor: string;
  differenceMinor: string;
  journalId: string | null;
}
export interface FxRate {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rateBps: number;
  effectiveAt: string;
  source: string;
}
export const recordReceipt = (body: Record<string, unknown>) =>
  identityRequest<{ id: string; state: string }>('/api/payments/receipts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const listReceipts = () => identityRequest<Receipt[]>('/api/payments/receipts');
export const listAllocatableInvoices = (receiptId: string) =>
  identityRequest<AllocatableInvoice[]>(
    `/api/payments/receipts/${encodeURIComponent(receiptId)}/allocatable-invoices`,
  );
export const verifyReceipt = (id: string, reason: string) =>
  identityRequest(`/api/payments/receipts/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
export const listBankLines = () =>
  identityRequest<BankLine[]>('/api/payments/bank-lines');
export const importBank = (body: Record<string, unknown>) =>
  identityRequest<{ id: string; rowCount: number }>('/api/payments/bank-imports', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const matchBankLine = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/payments/bank-lines/${id}/match`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const listExceptions = () =>
  identityRequest<PaymentException[]>('/api/payments/exceptions');
export const resolveException = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/payments/exceptions/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const allocateReceipt = (id: string, body: Record<string, unknown>) =>
  identityRequest(`/api/payments/receipts/${id}/allocate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createSettlement = (body: Record<string, unknown>) =>
  identityRequest('/api/payments/settlements', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const recordFxRate = (body: Record<string, unknown>) =>
  identityRequest('/api/payments/fx-rates', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const importSettlement = (body: Record<string, unknown>) =>
  identityRequest<{ id: string; rowCount: number }>('/api/payments/settlement-imports', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const revalueFx = (body: Record<string, unknown>) =>
  identityRequest('/api/payments/fx-revaluations', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const listSettlements = () =>
  identityRequest<Settlement[]>('/api/payments/settlements');
export const listFxRevaluations = () =>
  identityRequest<FxRevaluation[]>('/api/payments/fx-revaluations');
export const listFxRates = () => identityRequest<FxRate[]>('/api/payments/fx-rates');
