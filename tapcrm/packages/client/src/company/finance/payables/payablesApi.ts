import { identityRequest } from '../../../identity/api/authApi.js';
export interface Paginated<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
export interface Vendor {
  id: string;
  legalName: string;
  displayName: string;
  currency: string;
  status: string;
  paymentTermsDays: number;
}
export interface Bill {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  invoiceNumber: string;
  sourceType: string;
  dueDate: string;
  currency: string;
  total: string;
  extractionStatus: string;
  status: string;
  journalId: string | null;
}
export interface PaymentRun {
  id: string;
  currency: string;
  total: string;
  status: string;
  manifestSha256: string;
  journalId: string | null;
}
export interface BankChange {
  id: string;
  vendorId: string;
  vendorName: string;
  bankName: string;
  accountReference: string;
  ifsc: string | null;
  status: string;
  proposedBy: string;
  approvedBy: string | null;
  reason: string;
}
export interface PurchaseRequest {
  id: string;
  vendorId: string | null;
  description: string;
  amount: string;
  currency: string;
  status: string;
  matchedBillId: string | null;
}
export interface Subscription {
  id: string;
  vendorId: string;
  vendorName: string;
  name: string;
  amount: string;
  currency: string;
  recurrence: string;
  nextDueDate: string;
  status: string;
}
const pageQuery = (page: number, pageSize: number) => `page=${page}&pageSize=${pageSize}`;
export const listVendors = (page = 1, pageSize = 6) => identityRequest<Paginated<Vendor>>(`/api/payables/vendors?${pageQuery(page, pageSize)}`);
export const listBills = (page = 1, pageSize = 6) => identityRequest<Paginated<Bill>>(`/api/payables/bills?${pageQuery(page, pageSize)}`);
export const listRuns = (page = 1, pageSize = 6) => identityRequest<Paginated<PaymentRun>>(`/api/payables/runs?${pageQuery(page, pageSize)}`);
export const listBankChanges = (page = 1, pageSize = 6) => identityRequest<Paginated<BankChange>>(`/api/payables/vendor-bank-changes?${pageQuery(page, pageSize)}`);
export const listPurchaseRequests = (page = 1, pageSize = 6) => identityRequest<Paginated<PurchaseRequest>>(`/api/payables/purchase-requests?${pageQuery(page, pageSize)}`);
export const listSubscriptions = (page = 1, pageSize = 6) => identityRequest<Paginated<Subscription>>(`/api/payables/subscriptions?${pageQuery(page, pageSize)}`);
export const createVendor = (body: Record<string, unknown>) =>
  identityRequest('/api/payables/vendors', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const createBill = (body: Record<string, unknown>) =>
  identityRequest('/api/payables/bills', { method: 'POST', body: JSON.stringify(body) });
export const createSubscription = (body: Record<string, unknown>) =>
  identityRequest('/api/payables/subscriptions', { method: 'POST', body: JSON.stringify(body) });
export const createPurchaseRequest = (body: Record<string, unknown>) =>
  identityRequest('/api/payables/purchase-requests', { method: 'POST', body: JSON.stringify(body) });
export const createReimbursement = (claimId: string, reason: string) =>
  identityRequest('/api/payables/bills/from-expense', {
    method: 'POST',
    body: JSON.stringify({ claimId, reason }),
  });
export const approveBill = (id: string, reason: string) =>
  identityRequest(`/api/payables/bills/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
export const confirmExtraction = (id: string, reason: string) =>
  identityRequest(`/api/payables/bills/${id}/confirm-extraction`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
export const createRun = (billIds: string[], currency: string, reason: string) =>
  identityRequest('/api/payables/runs', {
    method: 'POST',
    body: JSON.stringify({ billIds, currency, reason }),
  });
export const approveRun = (id: string, reason: string) =>
  identityRequest(`/api/payables/runs/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
export const approvePurchaseRequest = (id: string, reason: string) =>
  identityRequest(`/api/payables/purchase-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
export const matchPurchaseRequest = (id: string, billId: string, reason: string) =>
  identityRequest(`/api/payables/purchase-requests/${id}/match-bill`, { method: 'POST', body: JSON.stringify({ billId, reason }) });
export const approveBankChange = (id: string, reason: string) =>
  identityRequest(`/api/payables/vendor-bank-changes/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
export const executeRun = (id: string, reason: string) =>
  identityRequest(`/api/payables/runs/${id}/execute`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
