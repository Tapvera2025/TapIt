import { identityRequest } from '../../../identity/api/authApi.js';
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
export const listVendors = () => identityRequest<Vendor[]>('/api/payables/vendors');
export const listBills = () => identityRequest<Bill[]>('/api/payables/bills');
export const listRuns = () => identityRequest<PaymentRun[]>('/api/payables/runs');
export const listBankChanges = () => identityRequest<BankChange[]>('/api/payables/vendor-bank-changes');
export const listPurchaseRequests = () => identityRequest<PurchaseRequest[]>('/api/payables/purchase-requests');
export const listSubscriptions = () => identityRequest<Subscription[]>('/api/payables/subscriptions');
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
