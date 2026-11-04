import { identityRequest } from '../../../identity/api/authApi.js';
export interface InvoiceDraft {
  id: string;
  clientId: string;
  legalEntityId: string;
  contractId: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: string;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  manifestFingerprint: string;
  version: number;
  reviewedAt: string | null;
  createdAt: string;
}
export interface IssuedInvoice extends InvoiceDraft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  journalId: string | null;
  issuedAt: string;
  deliveryStatus: string | null;
}
export const listDrafts = () => identityRequest<InvoiceDraft[]>('/api/invoicing/drafts');
export const listInvoices = () =>
  identityRequest<IssuedInvoice[]>('/api/invoicing/invoices');
export const createDraft = (body: Record<string, unknown>) =>
  identityRequest<InvoiceDraft>('/api/invoicing/drafts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const preview = (id: string) =>
  identityRequest<{
    draft: InvoiceDraft;
    contract: Record<string, unknown> | null;
    html: string;
  }>(`/api/invoicing/drafts/${id}/preview`);
export const review = (id: string, reason: string) =>
  identityRequest<{ draftId: string; reviewToken: string; manifestFingerprint: string }>(
    `/api/invoicing/drafts/${id}/review`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
export const confirm = (
  id: string,
  body: { reviewToken: string; manifestFingerprint: string; reason: string },
) =>
  identityRequest(`/api/invoicing/drafts/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const reviewBatch = (draftIds: string[], reason: string) =>
  identityRequest<{ batchToken: string; manifestFingerprint: string }>(
    '/api/invoicing/batches/review',
    { method: 'POST', body: JSON.stringify({ draftIds, reason }) },
  );
export const confirmBatch = (
  id: string,
  body: { batchToken: string; manifestFingerprint: string; reason: string },
) =>
  identityRequest(`/api/invoicing/batches/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
