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
export const listVendors = () => identityRequest<Vendor[]>('/api/payables/vendors');
export const listBills = () => identityRequest<Bill[]>('/api/payables/bills');
export const listRuns = () => identityRequest<PaymentRun[]>('/api/payables/runs');
export const createVendor = (body: Record<string, unknown>) =>
  identityRequest('/api/payables/vendors', {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
export const executeRun = (id: string, reason: string) =>
  identityRequest(`/api/payables/runs/${id}/execute`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
