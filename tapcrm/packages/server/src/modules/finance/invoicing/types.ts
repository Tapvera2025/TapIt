export type InvoiceDraftStatus = 'draft' | 'issued' | 'cancelled';
export interface InvoiceSource {
  sourceType: 'retainer' | 'milestone' | 'timesheet' | 'billable_event' | 'manual';
  sourceId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
  discount: string;
}
export interface InvoiceDraft {
  id: string;
  clientId: string;
  legalEntityId: string;
  contractId: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  status: InvoiceDraftStatus;
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
  receivableStatus: string;
}
