import type { ImportRowStatus, ImportSourceKind, ImportStatus, LeadCallStatus, PreviewRowStatus } from './api.js';

/** Pure display helpers for Lead Imports. No React, so they are unit-tested. */

export const IMPORTED_LEADS_PATH = '/company/sales/leads/imported';
export const ASSIGNED_LEAD_CALLS_PATH = '/company/sales/calls/assigned-leads';

/** What the file picker offers. Older formats are refused with a way out. */
export const UPLOAD_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xlsm,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const IMPORT_STATUS_LABELS: Readonly<Record<ImportStatus, string>> = {
  draft: 'Not started',
  queued: 'Starting…',
  importing: 'Importing…',
  completed: 'Imported',
  failed: 'Stopped',
  cancelled: 'Discarded',
};

export function importStatusTone(status: ImportStatus): string {
  if (status === 'completed') return 'border-app-success/30 bg-app-success/10 text-app-success';
  if (status === 'failed') return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
  if (status === 'queued' || status === 'importing') return 'border-app-accent/30 bg-app-accent/10 text-app-accent';
  return 'border-app-border bg-app-surface-raised text-app-muted';
}

export const ROW_STATUS_LABELS: Readonly<Record<ImportRowStatus, string>> = {
  pending: 'Waiting',
  created: 'Imported',
  existing: 'Already in CRM',
  duplicate: 'Repeated in file',
  invalid: 'Not imported',
  failed: 'Failed',
};

export function rowStatusTone(status: ImportRowStatus): string {
  if (status === 'created') return 'border-app-success/30 bg-app-success/10 text-app-success';
  if (status === 'invalid' || status === 'failed') return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
  if (status === 'existing' || status === 'duplicate') return 'border-app-accent/30 bg-app-accent/10 text-app-accent';
  return 'border-app-border bg-app-surface-raised text-app-muted';
}

export const PREVIEW_STATUS_LABELS: Readonly<Record<PreviewRowStatus, string>> = {
  ready: 'Ready',
  already_in_crm: 'Already in CRM',
  duplicate_in_file: 'Repeated in file',
  missing_contact: 'No phone or email',
  invalid_phone_format: 'Invalid phone',
  ambiguous_phone: 'Needs country code',
  invalid_email_format: 'Invalid email',
};

export function previewStatusTone(status: PreviewRowStatus): string {
  if (status === 'ready') return 'border-app-success/30 bg-app-success/10 text-app-success';
  if (status === 'already_in_crm' || status === 'duplicate_in_file') return 'border-app-accent/30 bg-app-accent/10 text-app-accent';
  return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
}

export const CALL_STATUS_LABELS: Readonly<Record<LeadCallStatus, string>> = {
  not_called: 'Not called yet',
  no_answer: 'Tried, no answer',
  connected: 'Connected',
  other: 'Called by someone else',
  no_phone: 'No phone number',
};

export function callStatusTone(status: LeadCallStatus): string {
  switch (status) {
    case 'connected':
      return 'border-app-success/30 bg-app-success/10 text-app-success';
    case 'no_answer':
      return 'border-app-accent/30 bg-app-accent/10 text-app-accent';
    case 'not_called':
      return 'border-app-danger/30 bg-app-danger/10 text-app-danger';
    default:
      return 'border-app-border bg-app-surface-raised text-app-muted';
  }
}

export function callStatusIcon(status: LeadCallStatus): string {
  switch (status) {
    case 'connected':
      return 'phone';
    case 'no_answer':
      return 'phone-missed';
    case 'other':
      return 'users';
    case 'no_phone':
      return 'alert-circle';
    default:
      return 'clock';
  }
}

export const SOURCE_KIND_LABELS: Readonly<Record<ImportSourceKind, string>> = {
  csv: 'CSV file',
  excel: 'Excel file',
  google_sheet: 'Google Sheet',
  paste: 'Pasted rows',
};

export function sourceKindIcon(kind: ImportSourceKind): string {
  if (kind === 'excel') return 'table';
  if (kind === 'google_sheet') return 'link';
  if (kind === 'paste') return 'clipboard';
  return 'file-text';
}

/** How many leads each person gets when `count` are split round-robin across `people`. */
export function splitCounts(count: number, people: number): number[] {
  if (people <= 0) return [];
  const base = Math.floor(count / people);
  const extra = count % people;
  return Array.from({ length: people }, (_unused, index) => base + (index < extra ? 1 : 0));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A sheet someone can fill in and upload as it is. */
export const TEMPLATE_CSV = [
  'Client Name,Business Name,Owner Name,Number,Email,City,Requirement,Assigned To,Notes',
  'Amit Shah,Shah Traders,Rakesh Shah,98765 43210,amit@shahtraders.in,Pune,Website,Rahul Verma,Call after 5 pm',
  'Neha Gupta,Neha Boutique,Neha Gupta,+91 91234 56789,,Mumbai,Social media,,',
].join('\n');

/** Import progress as a whole percentage (0 while nothing is known). */
export function importProgress(processed: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}

export function looksLikeGoogleSheet(value: string): boolean {
  return /^https?:\/\/docs\.google\.com\/spreadsheets\//i.test(value.trim());
}
