/**
 * The import itself: every pending row through the intake pipeline, then the
 * "Assigned to" column handed out. Runs in the background job (jobs.ts).
 *
 * Each row is its own unit: `ingest()` commits the lead in one transaction
 * and the row's outcome is written right after. A crash between the two is
 * harmless — the submission key is `<import>:<row>`, so the retry sees
 * "duplicate delivery" with the lead already made and only records it.
 * Progress is recounted from the rows, so it is exact after any restart.
 */

import { createJobContext, type RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { Principal } from '@tapcrm/contracts';
import { ingest } from '../intake/service.js';
import { insertActivity } from '../leads/repository.js';
import { assigneeKey } from './assignees.js';
import { assignImportedLeads } from './assign.js';
import { resolveAssignee } from './dry-run.js';
import { buildLeadFields, PROBLEM_LABELS, rowProblem, type RowProblem } from './mapping.js';
import {
  claimImport,
  ensureImportConnector,
  findImportRecord,
  findLeadSource,
  finishImport,
  leadCreatedByImport,
  listSalesEmployees,
  pendingRows,
  refreshImportProgress,
  saveRowOutcome,
  sheetAssignments,
  writeImportedLeadDetails,
  type ImportRecord,
  type PendingRow,
  type RowOutcome,
} from './repository.js';

/** A job that stopped sending heartbeats this long ago is presumed dead. */
export const STALE_IMPORT_MS = 10 * 60 * 1000;
const BATCH = 100;

/**
 * The context an import runs under: the person who started it, so every lead
 * is created by them (lead.created_by is a real user) and audited to them.
 */
export function importContext(organizationId: string, userId: string, runId: string): RequestContext {
  const principal: Principal = {
    id: userId,
    organizationId,
    sessionVersion: 0,
    accountType: 'service',
    allowedActions: [],
    allowedResources: [],
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  };
  return createJobContext({ organizationId, principal, jobName: 'sales.lead-import', runId });
}

export async function runImport(baseCtx: RequestContext, importId: string, runId: string): Promise<'done' | 'busy' | 'missing'> {
  const record = await findImportRecord(baseCtx, importId);
  if (!record) return 'missing';
  if (!(await claimImport(baseCtx, importId, STALE_IMPORT_MS))) return 'busy';
  const ctx = importContext(baseCtx.organizationId, record.startedBy ?? record.createdBy, runId);

  try {
    const source = record.leadSourceId ? await findLeadSource(ctx, record.leadSourceId) : null;
    if (!source || source.status !== 'active') throw new Error('The lead source chosen for this import is missing or inactive. Pick another source and import again.');
    const connectorId = await ensureImportConnector(ctx, { source, campaignId: record.campaignId, createdBy: ctx.principal.id });

    for (;;) {
      const rows = await pendingRows(ctx, importId, BATCH);
      if (rows.length === 0) break;
      for (const row of rows) await processRow(ctx, record, connectorId, row);
      await refreshImportProgress(ctx, importId);
    }

    await assignFromSheet(ctx, record);
    await refreshImportProgress(ctx, importId);
    await finishImport(ctx, importId, 'completed', null);
    return 'done';
  } catch (error) {
    await refreshImportProgress(ctx, importId).catch(() => undefined);
    await finishImport(ctx, importId, 'failed', error instanceof Error ? error.message.slice(0, 500) : String(error));
    throw error;
  }
}

async function processRow(ctx: RequestContext, record: ImportRecord, connectorId: string, row: PendingRow): Promise<void> {
  const fields = buildLeadFields(record.headers, row.cells, record.columnMapping, {
    defaultCountryCode: record.defaultCountryCode,
    extraColumnsToNotes: record.extraColumnsToNotes,
  });
  const phone = fields.phone?.ok ? fields.phone.e164 : null;
  const base = {
    contactName: fields.contactName,
    phone: phone ?? fields.phoneRaw,
    email: fields.email ?? fields.emailRaw,
    assigneeValue: fields.assignedTo,
  };

  const problem = rowProblem(fields);
  if (problem) {
    await saveRowOutcome(ctx, ctx.organizationId, row.id, { ...base, status: 'invalid', reason: problemText(problem), leadId: null, submissionId: null });
    return;
  }

  let outcome: RowOutcome;
  try {
    const result = await ingest(ctx, {
      connectorId,
      externalLeadId: `${record.id}:${row.rowNumber}`,
      mappedFields: {
        contactName: fields.contactName,
        phoneRaw: phone,
        emailRaw: fields.email,
        companyName: fields.companyName,
        serviceRequested: fields.requirement,
        location: fields.location,
        languagePreference: fields.language,
        message: fields.notes,
      },
      mappingVersion: 'lead-import-v1',
    });
    const priorCreated = result.outcome === 'duplicate_delivery' && result.reason === 'prior_outcome:created';
    if ((result.outcome === 'created' || priorCreated) && result.leadId) {
      outcome = { ...base, status: 'created', reason: null, leadId: result.leadId, submissionId: result.submissionId };
      const leadId = result.leadId;
      await db.transaction(ctx, async (tx) => {
        await writeImportedLeadDetails(tx, ctx.organizationId, leadId, {
          requirement: fields.requirement,
          location: fields.location,
          language: fields.language,
          notes: fields.notes,
        });
        await insertActivity(tx, ctx.organizationId, leadId, 'lead.created', ctx.principal.id, {
          importId: record.id,
          importName: record.name,
          rowNumber: row.rowNumber,
        });
        await saveRowOutcome(tx, ctx.organizationId, row.id, outcome);
      });
      return;
    }
    if (result.leadId && (result.outcome === 'linked_existing' || result.outcome === 'duplicate_delivery')) {
      const sameImport = await leadCreatedByImport(ctx, record.id, result.leadId);
      outcome = {
        ...base,
        status: sameImport ? 'duplicate' : 'existing',
        reason: sameImport ? 'Same phone or email as an earlier row' : 'Already an open lead in the CRM',
        leadId: result.leadId,
        submissionId: result.submissionId,
      };
    } else if (result.outcome === 'quarantined') {
      outcome = { ...base, status: 'invalid', reason: problemText(result.reason ?? 'missing_contact'), leadId: null, submissionId: result.submissionId };
    } else {
      outcome = { ...base, status: 'failed', reason: `Not imported (${result.outcome})`, leadId: null, submissionId: result.submissionId };
    }
  } catch (error) {
    outcome = { ...base, status: 'failed', reason: error instanceof Error ? error.message.slice(0, 300) : 'Could not be imported', leadId: null, submissionId: null };
  }
  await saveRowOutcome(ctx, ctx.organizationId, row.id, outcome);
}

function problemText(problem: string): string {
  return PROBLEM_LABELS[problem as RowProblem] ?? problem.replaceAll('_', ' ');
}

/**
 * The "Assigned to" column: each new lead goes to the person its row names,
 * by the import's name-to-employee matches, grouped so each person is told
 * once. Names that match nobody stay unassigned for someone to hand out.
 */
async function assignFromSheet(ctx: RequestContext, record: ImportRecord): Promise<void> {
  if (!Object.values(record.columnMapping).includes('assignedTo')) return;
  const rows = await sheetAssignments(ctx, record.id);
  if (rows.length === 0) return;
  const employees = await listSalesEmployees(ctx);
  const resolved = new Map<string, string | null>();
  const byEmployee = new Map<string, string[]>();
  for (const row of rows) {
    const key = assigneeKey(row.assigneeValue);
    if (!resolved.has(key)) resolved.set(key, resolveAssignee(row.assigneeValue, record.assigneeMapping, employees).employeeId);
    const employeeId = resolved.get(key);
    if (!employeeId) continue;
    const list = byEmployee.get(employeeId) ?? [];
    list.push(row.leadId);
    byEmployee.set(employeeId, list);
  }
  for (const [employeeId, leadIds] of byEmployee) {
    await assignImportedLeads(ctx, { leadIds, employeeIds: [employeeId], includeAssigned: false, via: 'sheet' });
  }
}

/** Imports left mid-way by a stopped worker, for the sweep to resume. */
export async function stalledImportIds(ctx: RequestContext): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`SELECT id FROM lead_import
         WHERE organization_id = ${ctx.organizationId}
           AND (status = 'queued' OR (status = 'importing' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ${STALE_IMPORT_MS / 1000}))))
         ORDER BY created_at`,
  );
  return rows.map((row) => row.id);
}
