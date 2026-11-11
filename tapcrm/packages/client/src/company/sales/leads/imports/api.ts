import { identityRequest } from '../../../../identity/api/authApi.js';

/** Lead Imports API (server: modules/sales/imports). */

export type ImportField =
  | 'contactName'
  | 'firstName'
  | 'lastName'
  | 'companyName'
  | 'ownerName'
  | 'phone'
  | 'email'
  | 'requirement'
  | 'location'
  | 'notes'
  | 'language'
  | 'assignedTo';

export type ImportSourceKind = 'csv' | 'excel' | 'google_sheet' | 'paste';
export type ImportStatus = 'draft' | 'queued' | 'importing' | 'completed' | 'failed' | 'cancelled';
export type ImportRowStatus = 'pending' | 'created' | 'existing' | 'duplicate' | 'invalid' | 'failed';
export type LeadCallStatus = 'not_called' | 'no_answer' | 'connected' | 'other' | 'no_phone';

export interface ImportSettings {
  name: string;
  columnMapping: Record<string, ImportField>;
  leadSourceId: string | null;
  campaignId: string | null;
  defaultCountryCode: string | null;
  extraColumnsToNotes: boolean;
  assigneeMapping: Record<string, string | null>;
}

export interface LeadImportSummary {
  id: string;
  name: string;
  sourceKind: ImportSourceKind;
  fileName: string | null;
  sheetName: string | null;
  status: ImportStatus;
  totalRows: number;
  processedRows: number;
  createdCount: number;
  existingCount: number;
  duplicateCount: number;
  invalidCount: number;
  failedCount: number;
  assignedCount: number;
  unassignedCount: number;
  leadSourceId: string | null;
  leadSourceName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface ImportFieldOption {
  field: ImportField;
  label: string;
  hint: string;
}

export interface LeadImportDetail extends LeadImportSummary {
  headers: string[];
  sampleRows: string[][];
  settings: ImportSettings;
  suggestedMapping: Record<string, ImportField>;
  sheets: string[];
  fields: ImportFieldOption[];
}

export type PreviewRowStatus =
  | 'ready'
  | 'already_in_crm'
  | 'duplicate_in_file'
  | 'missing_contact'
  | 'invalid_phone_format'
  | 'ambiguous_phone'
  | 'invalid_email_format';

export interface PreviewRow {
  rowNumber: number;
  status: PreviewRowStatus;
  contactName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  existingLeadNumber: string | null;
  existingOwnerName: string | null;
}

export interface PreviewAssignee {
  value: string;
  key: string;
  rows: number;
  employeeId: string | null;
  employeeName: string | null;
  match: 'auto' | 'manual' | 'none';
}

export interface ImportPreview {
  total: number;
  ready: number;
  alreadyInCrm: number;
  duplicateInFile: number;
  missingContact: number;
  invalidPhone: number;
  ambiguousPhone: number;
  invalidEmail: number;
  willBeAssigned: number;
  assigneeColumn: boolean;
  assignees: PreviewAssignee[];
  rows: PreviewRow[];
  problemRows: PreviewRow[];
}

export interface ImportRowView {
  rowNumber: number;
  status: ImportRowStatus;
  reason: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  assigneeValue: string | null;
  leadId: string | null;
  leadNumber: string | null;
  ownerName: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ImportedLeadItem {
  leadId: string;
  leadNumber: string;
  contactName: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  leadStatus: string;
  importId: string;
  importName: string;
  rowNumber: number;
  ownerId: string | null;
  ownerName: string | null;
  ownerTeamName: string | null;
  assignedAt: string | null;
  assignedByName: string | null;
  assignedVia: 'sheet' | 'manual' | null;
  callStatus: LeadCallStatus | null;
  callAttempts: number;
  lastCallAt: string | null;
  createdAt: string;
}

export interface ImportedLeadsPage extends Paginated<ImportedLeadItem> {
  counts: { all: number; unassigned: number; assigned: number };
  callTracking: boolean;
}

export interface ImportedLeadsFilter {
  importId?: string | undefined;
  assignment?: 'all' | 'unassigned' | 'assigned' | undefined;
  ownerId?: string | undefined;
  callStatus?: LeadCallStatus | undefined;
  search?: string | undefined;
}

export interface AssigneeOption {
  id: string;
  fullName: string;
  email: string | null;
  positionName: string | null;
  teamName: string | null;
  openLeads: number;
  availability: 'available' | 'on_leave' | 'not_punched_in' | 'unknown';
}

export interface AssignResult {
  assigned: number;
  reassigned: number;
  skipped: { closed: number; alreadyAssigned: number; notImported: number };
  byEmployee: Array<{ employeeId: string; fullName: string; count: number }>;
}

export interface CallTrackingTotals {
  assigned: number;
  withPhone: number;
  called: number;
  connected: number;
  noAnswer: number;
  notCalled: number;
  calledByOthers: number;
  overdue: number;
  avgFirstCallSeconds: number | null;
  talkSeconds: number;
}

export interface CallTrackingEmployee {
  employeeId: string;
  employeeName: string;
  teamName: string | null;
  assigned: number;
  called: number;
  connected: number;
  notCalled: number;
  overdue: number;
  avgFirstCallSeconds: number | null;
  talkSeconds: number;
  lastCallAt: string | null;
}

export interface CallTrackingLead {
  leadId: string;
  leadNumber: string;
  contactName: string;
  companyName: string | null;
  phone: string | null;
  importId: string;
  importName: string;
  ownerId: string;
  ownerName: string;
  assignedAt: string;
  assignedByName: string | null;
  status: LeadCallStatus;
  attempts: number;
  ownerCalls: number;
  connectedCalls: number;
  otherCalls: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  lastOutcome: string | null;
  talkSeconds: number;
}

export interface CallTrackingOverview {
  telephony: { enabled: boolean; connected: boolean; lastSyncAt: string | null };
  totals: CallTrackingTotals;
  employees: CallTrackingEmployee[];
  leads: CallTrackingLead[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CallTrackingFilters {
  importId?: string | undefined;
  ownerId?: string | undefined;
  assignedBy?: 'anyone' | 'me' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  status?: LeadCallStatus | 'all' | undefined;
  search?: string | undefined;
  sort?: 'assigned_desc' | 'assigned_asc' | 'last_call_desc' | 'waiting_longest' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface LeadCallMatch {
  id: string;
  provider: string;
  startedAt: string;
  direction: 'inbound' | 'outbound';
  outcome: string;
  talkSeconds: number;
  durationSeconds: number;
  contactNumber: string | null;
  employeeId: string | null;
  employeeName: string | null;
  byOwner: boolean;
  afterAssignment: boolean;
  hasRecording: boolean;
}

export interface LeadCallHistory {
  leadId: string;
  leadNumber: string;
  contactName: string;
  phone: string | null;
  ownerId: string | null;
  ownerName: string | null;
  assignedAt: string | null;
  calls: LeadCallMatch[];
}

function query(params: Readonly<Record<string, string | number | boolean | undefined | null>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, typeof value === 'string' ? value : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function listImports(): Promise<{ items: LeadImportSummary[] }> {
  return identityRequest('/api/lead-imports');
}

export type CreateImportInput =
  | { kind: 'file'; fileName: string; fileBase64: string; sheet?: string | undefined; name?: string | undefined }
  | { kind: 'google_sheet'; url: string; name?: string | undefined }
  | { kind: 'paste'; text: string; name?: string | undefined };

export function createImport(input: CreateImportInput): Promise<LeadImportDetail> {
  return identityRequest('/api/lead-imports', { method: 'POST', body: JSON.stringify(input) });
}

export function getImport(id: string): Promise<LeadImportDetail> {
  return identityRequest(`/api/lead-imports/${encodeURIComponent(id)}`);
}

export function previewImport(id: string, settings: ImportSettings): Promise<ImportPreview> {
  return identityRequest(`/api/lead-imports/${encodeURIComponent(id)}/preview`, { method: 'POST', body: JSON.stringify(settings) });
}

export function startImport(id: string, settings: ImportSettings): Promise<LeadImportSummary> {
  return identityRequest(`/api/lead-imports/${encodeURIComponent(id)}/start`, { method: 'POST', body: JSON.stringify(settings) });
}

export function resumeImport(id: string): Promise<LeadImportSummary> {
  return identityRequest(`/api/lead-imports/${encodeURIComponent(id)}/resume`, { method: 'POST' });
}

export function discardImport(id: string): Promise<{ id: string; status: 'cancelled' }> {
  return identityRequest(`/api/lead-imports/${encodeURIComponent(id)}/discard`, { method: 'POST' });
}

export function listImportRows(id: string, filters: { status?: string; page?: number; pageSize?: number } = {}): Promise<Paginated<ImportRowView>> {
  return identityRequest(`/api/lead-imports/${encodeURIComponent(id)}/rows${query(filters)}`);
}

export function listImportedLeads(filters: ImportedLeadsFilter & { page?: number; pageSize?: number }): Promise<ImportedLeadsPage> {
  return identityRequest(`/api/lead-imports/leads${query({ ...filters })}`);
}

export function listAssignees(): Promise<{ items: AssigneeOption[] }> {
  return identityRequest('/api/lead-imports/assignees');
}

export function assignLeads(input: { leadIds?: string[]; filter?: ImportedLeadsFilter; employeeIds: string[]; includeAssigned: boolean }): Promise<AssignResult> {
  return identityRequest('/api/lead-imports/assign', { method: 'POST', body: JSON.stringify(input) });
}

export function getCallTracking(filters: CallTrackingFilters): Promise<CallTrackingOverview> {
  return identityRequest(`/api/lead-imports/call-tracking${query({ ...filters })}`);
}

export function getLeadCalls(leadId: string): Promise<LeadCallHistory> {
  return identityRequest(`/api/lead-imports/call-tracking/leads/${encodeURIComponent(leadId)}`);
}

/** File bytes as base64 for the JSON upload (the server takes up to 10 MB). */
export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < buffer.length; index += chunk) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunk));
  }
  return btoa(binary);
}
