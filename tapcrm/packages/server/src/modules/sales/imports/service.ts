/**
 * Lead Imports (Sales): upload → match columns → review → import → assign,
 * then watch whether the assignees call. Bindings: AUTHORIZATION.md §6.5.
 *
 *   lead-imports:view    imports, imported leads, call tracking
 *   lead-imports:manage  upload, import and hand leads out
 *
 * Leads are made by the intake pipeline (`ingest()`), so an imported lead is a
 * lead like any other — My Work, callbacks, handovers and deals all apply —
 * and its duplicate handling is the CRM's: a contact with an open lead keeps
 * that lead instead of getting a second one.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { evaluateAvailability } from '../../../platform/availability/service.js';
import { enabledModuleKeys } from '../../../platform/module-entitlement.js';
import { assignImportedLeads } from './assign.js';
import { analyzeRows, buildPreview, contactKeys } from './dry-run.js';
import { ImportAssignError, ImportFileError, ImportNotFoundError, ImportStateError, ImportValidationError } from './errors.js';
import { fetchGoogleSheetCsv, GoogleSheetError, parseGoogleSheetUrl } from './google-sheets.js';
import { suggestMapping, type ImportField } from './mapping.js';
import { requestImportRun } from './jobs.js';
import {
  discardDraft,
  findCampaign,
  findExistingContacts,
  findImportRecord,
  findImportSummary,
  findLeadSource,
  importedCounts,
  importedLeadIds,
  insertDraftImport,
  lastImportDefaults,
  listImportedLeads,
  listImportRows,
  listImportSummaries,
  listSalesEmployees,
  loadRowCells,
  organizationTimeZone,
  queueImport,
  requeueFailedImport,
  telephonyConnections,
  updateDraftSettings,
} from './repository.js';
import { IMPORT_LIMITS, tableFromFile, tableFromText, type ImportTable } from './table.js';
import { callTracking, leadCallHistory } from './tracking.js';
import type {
  AssigneeOption,
  AssignResult,
  CallTrackingOverview,
  ImportFieldOption,
  ImportPreview,
  ImportSettings,
  LeadCallHistory,
  LeadImportDetail,
  LeadImportSummary,
  PaginatedImportedLeads,
  PaginatedImportRows,
} from './types.js';
import {
  ASSIGN_LIMIT,
  type AssignInput,
  type CallTrackingQuery,
  type CreateImportInput,
  type ImportedLeadsQuery,
  type ImportRowsQuery,
  type ImportSettingsInput,
} from './validators.js';

export const FIELD_OPTIONS: readonly ImportFieldOption[] = [
  { field: 'contactName', label: 'Client name', hint: 'The person to speak to' },
  { field: 'firstName', label: 'First name', hint: 'Joined with the last name' },
  { field: 'lastName', label: 'Last name', hint: 'Joined with the first name' },
  { field: 'companyName', label: 'Business name', hint: 'The company or shop' },
  { field: 'ownerName', label: 'Business owner', hint: 'Becomes the contact when there is no client name' },
  { field: 'phone', label: 'Phone number', hint: 'Used to match JustCall and Aircall calls' },
  { field: 'email', label: 'Email', hint: '' },
  { field: 'requirement', label: 'Requirement', hint: 'What they need or asked about' },
  { field: 'location', label: 'City / location', hint: '' },
  { field: 'notes', label: 'Notes', hint: 'Added to the lead notes' },
  { field: 'language', label: 'Language', hint: '' },
  { field: 'assignedTo', label: 'Assigned to', hint: 'A salesperson’s name or email' },
];

const SAMPLE_ROWS = 8;

/* ==================================================================== *
 * Imports
 * ==================================================================== */

export async function listImports(ctx: RequestContext, limit: number): Promise<{ items: LeadImportSummary[] }> {
  return { items: await listImportSummaries(ctx, limit) };
}

export async function createImport(ctx: RequestContext, input: CreateImportInput): Promise<LeadImportDetail> {
  let table: ImportTable;
  let fileName: string | null = null;
  let sourceUrl: string | null = null;
  let suggestedName: string;

  if (input.kind === 'file') {
    const bytes = decodeBase64(input.fileBase64);
    table = tableFromFile(input.fileName, bytes, input.sheet ?? null);
    fileName = input.fileName;
    suggestedName = nameFromFile(input.fileName);
    if (table.sheet && table.sheets.length > 1) suggestedName = `${suggestedName} · ${table.sheet}`;
  } else if (input.kind === 'google_sheet') {
    const link = parseGoogleSheetUrl(input.url);
    if (!link) throw new ImportFileError('That is not a Google Sheets link. Copy the link from the address bar of the sheet, with the tab you want open.');
    try {
      const sheet = await fetchGoogleSheetCsv(link);
      table = tableFromText(sheet.text, 'google_sheet', sheet.digestSource);
      suggestedName = sheet.title ?? 'Google Sheet';
    } catch (error) {
      if (error instanceof GoogleSheetError) throw new ImportFileError(error.message);
      throw error;
    }
    sourceUrl = `https://docs.google.com/spreadsheets/d/${link.published ? 'e/' : ''}${link.spreadsheetId}/${link.gid ? `edit#gid=${link.gid}` : 'edit'}`;
  } else {
    table = tableFromText(input.text, 'paste');
    suggestedName = `Pasted list · ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: await organizationTimeZone(ctx) }).format(new Date())}`;
  }

  const settings = await defaultSettings(ctx, input.name ?? suggestedName, table);
  const id = await insertDraftImport(ctx, {
    name: settings.name,
    kind: table.kind,
    fileName,
    sourceUrl,
    sheetName: table.sheet,
    digest: table.digest,
    headers: table.headers,
    rows: table.rows,
    settings,
  });
  const detail = await getImport(ctx, id);
  return { ...detail, sheets: table.sheets };
}

async function defaultSettings(ctx: RequestContext, name: string, table: ImportTable): Promise<ImportSettings> {
  const previous = await lastImportDefaults(ctx);
  const countryCode = previous?.defaultCountryCode ?? countryCodeForTimeZone(await organizationTimeZone(ctx));
  let leadSourceId = previous?.leadSourceId ?? null;
  if (leadSourceId) {
    const source = await findLeadSource(ctx, leadSourceId);
    if (!source || source.status !== 'active') leadSourceId = null;
  }
  return {
    name: name.slice(0, 160),
    columnMapping: suggestMapping(table.headers, table.rows.slice(0, 50)),
    leadSourceId,
    campaignId: null,
    defaultCountryCode: countryCode,
    extraColumnsToNotes: true,
    assigneeMapping: {},
  };
}

export async function getImport(ctx: RequestContext, id: string): Promise<LeadImportDetail> {
  const [summary, record] = await Promise.all([findImportSummary(ctx, id), findImportRecord(ctx, id)]);
  if (!summary || !record) throw new ImportNotFoundError();
  const sample = await loadRowCells(ctx, id, 50);
  return {
    ...summary,
    headers: record.headers,
    sampleRows: sample.slice(0, SAMPLE_ROWS).map((row) => row.cells),
    settings: {
      name: record.name,
      columnMapping: record.columnMapping,
      leadSourceId: record.leadSourceId,
      campaignId: record.campaignId,
      defaultCountryCode: record.defaultCountryCode,
      extraColumnsToNotes: record.extraColumnsToNotes,
      assigneeMapping: record.assigneeMapping,
    },
    suggestedMapping: suggestMapping(record.headers, sample.map((row) => row.cells)),
    sheets: [],
    fields: FIELD_OPTIONS,
  };
}

function settingsFrom(input: ImportSettingsInput, headers: readonly string[]): ImportSettings {
  const columnMapping: Record<string, ImportField> = {};
  for (const [column, field] of Object.entries(input.columnMapping)) {
    if (Number(column) < headers.length) columnMapping[column] = field;
  }
  return {
    name: input.name,
    columnMapping,
    leadSourceId: input.leadSourceId,
    campaignId: input.campaignId,
    defaultCountryCode: input.defaultCountryCode,
    extraColumnsToNotes: input.extraColumnsToNotes,
    assigneeMapping: input.assigneeMapping,
  };
}

async function draftRecord(ctx: RequestContext, id: string) {
  const record = await findImportRecord(ctx, id);
  if (!record) throw new ImportNotFoundError();
  if (record.status !== 'draft') throw new ImportStateError('This import has already started. Its leads are in the Imported leads list.');
  return record;
}

async function checkSourceAndCampaign(ctx: RequestContext, settings: ImportSettings, required: boolean): Promise<void> {
  if (settings.leadSourceId) {
    const source = await findLeadSource(ctx, settings.leadSourceId);
    if (!source || source.status !== 'active') throw new ImportValidationError('That lead source is missing or inactive. Pick another one.');
  } else if (required) {
    throw new ImportValidationError('Pick the lead source these leads came from.');
  }
  if (settings.campaignId) {
    const campaign = await findCampaign(ctx, settings.campaignId);
    if (!campaign || campaign.status !== 'active') throw new ImportValidationError('That campaign is missing or inactive. Pick another one or none.');
  }
}

/** Save the wizard's choices and say what the import would do (nothing is imported). */
export async function previewImport(ctx: RequestContext, id: string, input: ImportSettingsInput): Promise<ImportPreview> {
  const record = await draftRecord(ctx, id);
  const settings = settingsFrom(input, record.headers);
  await checkSourceAndCampaign(ctx, settings, false);
  if (!(await updateDraftSettings(ctx, id, settings))) throw new ImportStateError('This import has already started.');
  return computePreview(ctx, record.headers, id, settings);
}

async function computePreview(ctx: RequestContext, headers: readonly string[], id: string, settings: ImportSettings): Promise<ImportPreview> {
  const rows = await loadRowCells(ctx, id, IMPORT_LIMITS.MAX_ROWS);
  const analyzed = analyzeRows(headers, rows, settings);
  const keys = contactKeys(analyzed);
  const [existing, employees] = await Promise.all([findExistingContacts(ctx, keys.phones, keys.emails), listSalesEmployees(ctx)]);
  return buildPreview(analyzed, existing, settings, employees);
}

export async function startImport(ctx: RequestContext, id: string, input: ImportSettingsInput): Promise<LeadImportSummary> {
  const record = await draftRecord(ctx, id);
  const settings = settingsFrom(input, record.headers);
  const fields = new Set(Object.values(settings.columnMapping));
  if (!fields.has('phone') && !fields.has('email')) {
    throw new ImportValidationError('Match a column to Phone number or Email: a lead needs one of them.');
  }
  await checkSourceAndCampaign(ctx, settings, true);
  if (!(await queueImport(ctx, id, settings))) throw new ImportStateError('This import has already started.');
  await requestImportRun(ctx, id);
  const summary = await findImportSummary(ctx, id);
  if (!summary) throw new ImportNotFoundError();
  return summary;
}

/** A failed import continues with the rows it had not reached. */
export async function resumeImport(ctx: RequestContext, id: string): Promise<LeadImportSummary> {
  if (!(await requeueFailedImport(ctx, id))) {
    const record = await findImportRecord(ctx, id);
    if (!record) throw new ImportNotFoundError();
    throw new ImportStateError('Only an import that stopped with an error can be resumed.');
  }
  await requestImportRun(ctx, id);
  const summary = await findImportSummary(ctx, id);
  if (!summary) throw new ImportNotFoundError();
  return summary;
}

export async function discardImport(ctx: RequestContext, id: string): Promise<{ id: string; status: 'cancelled' }> {
  if (!(await discardDraft(ctx, id))) {
    const record = await findImportRecord(ctx, id);
    if (!record) throw new ImportNotFoundError();
    throw new ImportStateError('Only an import that has not started can be discarded.');
  }
  return { id, status: 'cancelled' };
}

export async function listRows(ctx: RequestContext, id: string, query: ImportRowsQuery): Promise<PaginatedImportRows> {
  const record = await findImportRecord(ctx, id);
  if (!record) throw new ImportNotFoundError();
  const { items, total } = await listImportRows(ctx, id, query);
  return { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

/* ==================================================================== *
 * Imported leads and assignment
 * ==================================================================== */

async function callTrackingOn(ctx: RequestContext): Promise<boolean> {
  return (await enabledModuleKeys(ctx.organizationId)).includes('telephony');
}

export async function listImported(ctx: RequestContext, query: ImportedLeadsQuery): Promise<PaginatedImportedLeads> {
  const withCalls = await callTrackingOn(ctx);
  const [page, counts] = await Promise.all([
    listImportedLeads(ctx, query, { page: query.page, pageSize: query.pageSize }, withCalls),
    importedCounts(ctx, query),
  ]);
  return {
    items: page.items,
    total: page.total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(page.total / query.pageSize)),
    counts,
    callTracking: withCalls,
  };
}

export async function assign(ctx: RequestContext, input: AssignInput): Promise<AssignResult> {
  let leadIds = input.leadIds ?? [];
  if (leadIds.length === 0 && input.filter) {
    leadIds = await importedLeadIds(ctx, input.filter, await callTrackingOn(ctx), ASSIGN_LIMIT + 1);
    if (leadIds.length > ASSIGN_LIMIT) {
      throw new ImportAssignError(`That is more than ${ASSIGN_LIMIT.toLocaleString('en-US')} leads. Narrow the filters and assign them in parts.`);
    }
  }
  if (leadIds.length === 0) throw new ImportAssignError('There are no leads to assign with these filters.');
  return assignImportedLeads(ctx, { leadIds, employeeIds: input.employeeIds, includeAssigned: input.includeAssigned, via: 'manual' });
}

export async function assignees(ctx: RequestContext): Promise<{ items: AssigneeOption[] }> {
  const people = await listSalesEmployees(ctx);
  const availability = new Map<string, AssigneeOption['availability']>();
  try {
    for (const result of await evaluateAvailability(ctx, people.map((person) => person.id), { pool: 'direct' })) {
      availability.set(
        result.userId,
        result.reasons.includes('on_leave') || result.reasons.includes('on_holiday')
          ? 'on_leave'
          : result.reasons.includes('not_punched_in')
            ? 'not_punched_in'
            : result.reasons.includes('service_unavailable')
              ? 'unknown'
              : 'available',
      );
    }
  } catch {
    // Attendance is a hint here, never a reason to fail the list.
  }
  return { items: people.map((person) => ({ ...person, availability: availability.get(person.id) ?? 'unknown' })) };
}

/* ==================================================================== *
 * Call tracking
 * ==================================================================== */

export async function trackCalls(ctx: RequestContext, query: CallTrackingQuery): Promise<CallTrackingOverview> {
  const [enabled, connections, timeZone] = await Promise.all([callTrackingOn(ctx), telephonyConnections(ctx), organizationTimeZone(ctx)]);
  const result = await callTracking(ctx, query, timeZone);
  return {
    telephony: { enabled, connected: connections.connected, lastSyncAt: connections.lastSyncAt },
    totals: result.totals,
    employees: result.employees,
    leads: result.leads,
    page: query.page,
    pageSize: query.pageSize,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
  };
}

export async function leadCalls(ctx: RequestContext, leadId: string): Promise<LeadCallHistory> {
  return leadCallHistory(ctx, leadId);
}

/* ==================================================================== *
 * Helpers
 * ==================================================================== */

/** "expo_leads-november.csv" → "Expo leads november". */
export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Imported leads';
}

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new ImportFileError('The file did not arrive intact. Try uploading it again.');
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

/** Calling codes for the company's timezone, for numbers written without one. */
const TIME_ZONE_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Asia\/(Kolkata|Calcutta)$/, '91'],
  [/^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana\/.+|Kentucky\/.+|Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns)|Pacific\/Honolulu)$/, '1'],
  [/^Europe\/(London|Belfast)$/, '44'],
  [/^Asia\/Dubai$/, '971'],
  [/^Asia\/Singapore$/, '65'],
  [/^Australia\//, '61'],
  [/^Asia\/Karachi$/, '92'],
  [/^Asia\/Dhaka$/, '880'],
  [/^Asia\/(Kathmandu|Katmandu)$/, '977'],
  [/^Asia\/Colombo$/, '94'],
  [/^Asia\/Riyadh$/, '966'],
  [/^Asia\/Qatar$/, '974'],
  [/^Asia\/Kuala_Lumpur$/, '60'],
  [/^Asia\/Jakarta$/, '62'],
  [/^Asia\/Manila$/, '63'],
  [/^Africa\/Lagos$/, '234'],
  [/^Africa\/Nairobi$/, '254'],
  [/^Africa\/Johannesburg$/, '27'],
  [/^Europe\/Berlin$/, '49'],
  [/^Europe\/Paris$/, '33'],
];

export function countryCodeForTimeZone(timeZone: string): string | null {
  return TIME_ZONE_CODES.find(([pattern]) => pattern.test(timeZone))?.[1] ?? null;
}
