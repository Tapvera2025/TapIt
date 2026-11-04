/**
 * The dry run behind the import wizard's review step (PRD R-IMP-01): what each
 * row would become with the chosen column matches, without writing anything.
 * Pure: the caller supplies the contacts already in the CRM.
 *
 * It mirrors what the import itself does, so the numbers it shows are the
 * numbers the import produces: a row needs a valid phone or email; a phone or
 * email seen earlier in the file is a duplicate; a contact that already has an
 * open lead is linked to it rather than given a second one.
 */

import { assigneeKey, matchAssignee, type AssigneeCandidate } from './assignees.js';
import { buildLeadFields, rowProblem, type ColumnMapping, type RowLeadFields } from './mapping.js';
import type { ImportPreview, ImportSettings, PreviewAssignee, PreviewRow, PreviewRowStatus } from './types.js';

export interface PreviewSourceRow {
  readonly rowNumber: number;
  readonly cells: readonly string[];
}

export interface AnalyzedRow {
  readonly rowNumber: number;
  readonly fields: RowLeadFields;
  readonly status: PreviewRowStatus;
}

/** Lead fields and a first verdict for every row; "already in CRM" comes later. */
export function analyzeRows(headers: readonly string[], rows: readonly PreviewSourceRow[], settings: ImportSettings): AnalyzedRow[] {
  const mapping: ColumnMapping = settings.columnMapping;
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  return rows.map((row) => {
    const fields = buildLeadFields(headers, row.cells, mapping, {
      defaultCountryCode: settings.defaultCountryCode,
      extraColumnsToNotes: settings.extraColumnsToNotes,
    });
    const problem = rowProblem(fields);
    if (problem) return { rowNumber: row.rowNumber, fields, status: problem };
    const phone = fields.phone?.ok ? fields.phone.e164 : null;
    const duplicate = (phone !== null && seenPhones.has(phone)) || (fields.email !== null && seenEmails.has(fields.email));
    if (phone) seenPhones.add(phone);
    if (fields.email) seenEmails.add(fields.email);
    return { rowNumber: row.rowNumber, fields, status: duplicate ? 'duplicate_in_file' : 'ready' };
  });
}

/** Phones and emails worth looking up in the CRM. */
export function contactKeys(rows: readonly AnalyzedRow[]): { phones: string[]; emails: string[] } {
  const phones = new Set<string>();
  const emails = new Set<string>();
  for (const row of rows) {
    if (row.status !== 'ready') continue;
    if (row.fields.phone?.ok) phones.add(row.fields.phone.e164);
    if (row.fields.email) emails.add(row.fields.email);
  }
  return { phones: [...phones], emails: [...emails] };
}

export interface ExistingContact {
  readonly phone: string | null;
  readonly email: string | null;
  /** The contact's open lead; null when it has none (a new lead is made). */
  readonly leadNumber: string | null;
  readonly ownerName: string | null;
}

export interface AssigneeResolution {
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly match: PreviewAssignee['match'];
}

/**
 * Who an "Assigned to" value goes to: the person importing's choice when they
 * made one (null meaning "leave unassigned"), otherwise a confident match.
 */
export function resolveAssignee<T extends AssigneeCandidate>(
  value: string,
  overrides: Readonly<Record<string, string | null>>,
  employees: readonly T[],
): AssigneeResolution {
  const key = assigneeKey(value);
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    const chosen = overrides[key] ?? null;
    const employee = chosen ? employees.find((candidate) => candidate.id === chosen) : undefined;
    return { employeeId: employee?.id ?? null, employeeName: employee?.fullName ?? null, match: employee ? 'manual' : 'none' };
  }
  const match = matchAssignee(value, employees);
  return { employeeId: match?.id ?? null, employeeName: match?.fullName ?? null, match: match ? 'auto' : 'none' };
}

const SAMPLE_ROWS = 50;
const PROBLEM_ROWS = 200;

export function buildPreview<T extends AssigneeCandidate>(
  analyzed: readonly AnalyzedRow[],
  existing: readonly ExistingContact[],
  settings: ImportSettings,
  employees: readonly T[],
): ImportPreview {
  const byPhone = new Map<string, ExistingContact>();
  const byEmail = new Map<string, ExistingContact>();
  for (const contact of existing) {
    if (contact.phone) byPhone.set(contact.phone, contact);
    if (contact.email) byEmail.set(contact.email.toLowerCase(), contact);
  }
  const assigneeColumn = Object.values(settings.columnMapping).includes('assignedTo');
  const assignees = new Map<string, { value: string; rows: number; resolution: AssigneeResolution }>();

  const counts = { ready: 0, alreadyInCrm: 0, duplicateInFile: 0, missingContact: 0, invalidPhone: 0, ambiguousPhone: 0, invalidEmail: 0, willBeAssigned: 0 };
  const rows: PreviewRow[] = [];
  const problemRows: PreviewRow[] = [];

  for (const row of analyzed) {
    let status = row.status;
    let existingContact: ExistingContact | undefined;
    if (status === 'ready') {
      const phone = row.fields.phone?.ok ? row.fields.phone.e164 : null;
      existingContact = (phone ? byPhone.get(phone) : undefined) ?? (row.fields.email ? byEmail.get(row.fields.email) : undefined);
      if (existingContact?.leadNumber) status = 'already_in_crm';
    }

    let resolution: AssigneeResolution | null = null;
    if (assigneeColumn && row.fields.assignedTo && status === 'ready') {
      const key = assigneeKey(row.fields.assignedTo);
      const entry = assignees.get(key);
      if (entry) {
        entry.rows++;
        resolution = entry.resolution;
      } else {
        resolution = resolveAssignee(row.fields.assignedTo, settings.assigneeMapping, employees);
        assignees.set(key, { value: row.fields.assignedTo, rows: 1, resolution });
      }
      if (resolution.employeeId) counts.willBeAssigned++;
    }

    switch (status) {
      case 'ready':
        counts.ready++;
        break;
      case 'already_in_crm':
        counts.alreadyInCrm++;
        break;
      case 'duplicate_in_file':
        counts.duplicateInFile++;
        break;
      case 'missing_contact':
        counts.missingContact++;
        break;
      case 'invalid_phone_format':
        counts.invalidPhone++;
        break;
      case 'ambiguous_phone':
        counts.ambiguousPhone++;
        break;
      case 'invalid_email_format':
        counts.invalidEmail++;
        break;
    }

    const view: PreviewRow = {
      rowNumber: row.rowNumber,
      status,
      contactName: row.fields.contactName,
      companyName: row.fields.companyName,
      phone: row.fields.phone?.ok ? row.fields.phone.e164 : row.fields.phoneRaw,
      email: row.fields.email ?? row.fields.emailRaw,
      assignedTo: row.fields.assignedTo,
      assigneeName: resolution?.employeeName ?? null,
      existingLeadNumber: status === 'already_in_crm' ? (existingContact?.leadNumber ?? null) : null,
      existingOwnerName: status === 'already_in_crm' ? (existingContact?.ownerName ?? null) : null,
    };
    if (rows.length < SAMPLE_ROWS) rows.push(view);
    if (status !== 'ready' && problemRows.length < PROBLEM_ROWS) problemRows.push(view);
  }

  return {
    total: analyzed.length,
    ...counts,
    assigneeColumn,
    assignees: [...assignees.entries()]
      .map(([key, entry]) => ({
        value: entry.value,
        key,
        rows: entry.rows,
        employeeId: entry.resolution.employeeId,
        employeeName: entry.resolution.employeeName,
        match: entry.resolution.match,
      }))
      .sort((a, b) => Number(a.employeeId !== null) - Number(b.employeeId !== null) || b.rows - a.rows),
    rows,
    problemRows,
  };
}
