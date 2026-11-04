import type { ImportField } from './mapping.js';
import type { ImportSourceKind } from './table.js';

export type ImportStatus = 'draft' | 'queued' | 'importing' | 'completed' | 'failed' | 'cancelled';
export type ImportRowStatus = 'pending' | 'created' | 'existing' | 'duplicate' | 'invalid' | 'failed';
export type AssignedVia = 'sheet' | 'manual';

/** What the person importing chose in the wizard. */
export interface ImportSettings {
  readonly name: string;
  readonly columnMapping: Readonly<Record<string, ImportField>>;
  readonly leadSourceId: string | null;
  readonly campaignId: string | null;
  readonly defaultCountryCode: string | null;
  readonly extraColumnsToNotes: boolean;
  /** assigneeKey(value) → employee id, or null to leave those rows unassigned. */
  readonly assigneeMapping: Readonly<Record<string, string | null>>;
}

export interface LeadImportSummary {
  readonly id: string;
  readonly name: string;
  readonly sourceKind: ImportSourceKind;
  readonly fileName: string | null;
  readonly sheetName: string | null;
  readonly status: ImportStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  readonly createdCount: number;
  readonly existingCount: number;
  readonly duplicateCount: number;
  readonly invalidCount: number;
  readonly failedCount: number;
  /** Leads this import created that have an owner now / still have none. */
  readonly assignedCount: number;
  readonly unassignedCount: number;
  readonly leadSourceId: string | null;
  readonly leadSourceName: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly createdBy: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly lastError: string | null;
}

export interface ImportFieldOption {
  readonly field: ImportField;
  readonly label: string;
  readonly hint: string;
}

export interface LeadImportDetail extends LeadImportSummary {
  readonly headers: readonly string[];
  readonly sampleRows: readonly (readonly string[])[];
  readonly settings: ImportSettings;
  readonly suggestedMapping: Readonly<Record<string, ImportField>>;
  /** Excel only, and only in the upload response: the workbook's sheets. */
  readonly sheets: readonly string[];
  readonly fields: readonly ImportFieldOption[];
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
  readonly rowNumber: number;
  readonly status: PreviewRowStatus;
  readonly contactName: string | null;
  readonly companyName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly assignedTo: string | null;
  readonly assigneeName: string | null;
  readonly existingLeadNumber: string | null;
  readonly existingOwnerName: string | null;
}

export interface PreviewAssignee {
  readonly value: string;
  readonly key: string;
  readonly rows: number;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  /** How the employee was picked: matched by name/email, chosen by hand, or not at all. */
  readonly match: 'auto' | 'manual' | 'none';
}

export interface ImportPreview {
  readonly total: number;
  readonly ready: number;
  readonly alreadyInCrm: number;
  readonly duplicateInFile: number;
  readonly missingContact: number;
  readonly invalidPhone: number;
  readonly ambiguousPhone: number;
  readonly invalidEmail: number;
  /** Ready rows that the "Assigned to" column will hand to someone. */
  readonly willBeAssigned: number;
  readonly assigneeColumn: boolean;
  readonly assignees: readonly PreviewAssignee[];
  readonly rows: readonly PreviewRow[];
  readonly problemRows: readonly PreviewRow[];
}

export interface ImportRowView {
  readonly rowNumber: number;
  readonly status: ImportRowStatus;
  readonly reason: string | null;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly assigneeValue: string | null;
  readonly leadId: string | null;
  readonly leadNumber: string | null;
  readonly ownerName: string | null;
}

export interface PaginatedImportRows {
  readonly items: readonly ImportRowView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export type LeadCallStatus = 'not_called' | 'no_answer' | 'connected' | 'other' | 'no_phone';

export interface ImportedLeadItem {
  readonly leadId: string;
  readonly leadNumber: string;
  readonly contactName: string;
  readonly companyName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly leadStatus: string;
  readonly importId: string;
  readonly importName: string;
  readonly rowNumber: number;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly ownerTeamName: string | null;
  readonly assignedAt: string | null;
  readonly assignedByName: string | null;
  readonly assignedVia: AssignedVia | null;
  /** Null when Call Analytics is off for the company. */
  readonly callStatus: LeadCallStatus | null;
  readonly callAttempts: number;
  readonly lastCallAt: string | null;
  readonly createdAt: string;
}

export interface PaginatedImportedLeads {
  readonly items: readonly ImportedLeadItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly counts: { readonly all: number; readonly unassigned: number; readonly assigned: number };
  readonly callTracking: boolean;
}

export interface AssigneeOption {
  readonly id: string;
  readonly fullName: string;
  readonly email: string | null;
  readonly positionName: string | null;
  readonly teamName: string | null;
  readonly openLeads: number;
  /** Today, from attendance: on leave or not yet in. Assigning still works. */
  readonly availability: 'available' | 'on_leave' | 'not_punched_in' | 'unknown';
}

export interface AssignResult {
  readonly assigned: number;
  readonly reassigned: number;
  readonly skipped: { readonly closed: number; readonly alreadyAssigned: number; readonly notImported: number };
  readonly byEmployee: ReadonlyArray<{ readonly employeeId: string; readonly fullName: string; readonly count: number }>;
}

export interface CallTrackingTotals {
  readonly assigned: number;
  readonly withPhone: number;
  readonly called: number;
  readonly connected: number;
  readonly noAnswer: number;
  readonly notCalled: number;
  readonly calledByOthers: number;
  /** Not called by the assignee and assigned more than a day ago. */
  readonly overdue: number;
  readonly avgFirstCallSeconds: number | null;
  readonly talkSeconds: number;
}

export interface CallTrackingEmployee {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly teamName: string | null;
  readonly assigned: number;
  readonly called: number;
  readonly connected: number;
  readonly notCalled: number;
  readonly overdue: number;
  readonly avgFirstCallSeconds: number | null;
  readonly talkSeconds: number;
  readonly lastCallAt: string | null;
}

export interface CallTrackingLead {
  readonly leadId: string;
  readonly leadNumber: string;
  readonly contactName: string;
  readonly companyName: string | null;
  readonly phone: string | null;
  readonly importId: string;
  readonly importName: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly assignedAt: string;
  readonly assignedByName: string | null;
  readonly status: LeadCallStatus;
  readonly attempts: number;
  readonly ownerCalls: number;
  readonly connectedCalls: number;
  readonly otherCalls: number;
  readonly firstCallAt: string | null;
  readonly lastCallAt: string | null;
  readonly lastOutcome: string | null;
  readonly talkSeconds: number;
}

export interface CallTrackingTelephony {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly lastSyncAt: string | null;
}

export interface CallTrackingOverview {
  readonly telephony: CallTrackingTelephony;
  readonly totals: CallTrackingTotals;
  readonly employees: readonly CallTrackingEmployee[];
  readonly leads: readonly CallTrackingLead[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface LeadCallMatch {
  readonly id: string;
  readonly provider: string;
  readonly startedAt: string;
  readonly direction: 'inbound' | 'outbound';
  readonly outcome: string;
  readonly talkSeconds: number;
  readonly durationSeconds: number;
  readonly contactNumber: string | null;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly byOwner: boolean;
  readonly afterAssignment: boolean;
  readonly hasRecording: boolean;
}

export interface LeadCallHistory {
  readonly leadId: string;
  readonly leadNumber: string;
  readonly contactName: string;
  readonly phone: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly assignedAt: string | null;
  readonly calls: readonly LeadCallMatch[];
}
