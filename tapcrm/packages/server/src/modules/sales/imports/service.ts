/**
 * Sales v1.1 — CSV import orchestration (R1 plan step 1.11).
 *
 * The flow is a single endpoint with a `dryRun` flag rather than the
 * two-call `POST /lead-imports` + `POST /lead-imports/:id/commit`
 * dance from the plan. For a Super-Admin pilot that keeps the user
 * flow simple: upload, see the report, flip a toggle, upload again to
 * commit. Adding a persisted `lead_import` row with a two-phase handoff
 * is a straightforward follow-up when the pilot wants it.
 *
 * `rowKey` doubles as `external_lead_id` on the submission, so
 * `ingest()`'s unique index guarantees "one lead per rowKey" on retries.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { ApplicationError } from '../../../errors.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import { ingest } from '../intake/service.js';
import type { IntakePayload } from '../intake/types.js';
import { parseCsv, toRecords } from './parser.js';
import {
  validateRows,
  type ImportRowResult,
  type ImportSummary,
  type RowValidationContext,
} from './dry-run.js';

export const IMPORT_ERROR_CODES = {
  FORBIDDEN_FOR_NON_SUPER_ADMIN: 'IMPORT_FORBIDDEN',
  TOO_MANY_ROWS: 'IMPORT_TOO_MANY_ROWS',
  CONNECTOR_INVALID: 'IMPORT_CONNECTOR_INVALID',
} as const;

export const IMPORT_LIMITS = {
  MAX_BYTES: 20 * 1024 * 1024,
  MAX_ROWS: 10_000,
} as const;

export class ImportTooManyRowsError extends ApplicationError {
  constructor(count: number) {
    super(`Import has ${count} rows; the limit is ${IMPORT_LIMITS.MAX_ROWS}`, 413, IMPORT_ERROR_CODES.TOO_MANY_ROWS);
    this.name = 'ImportTooManyRowsError';
  }
}
export class ImportConnectorInvalidError extends ApplicationError {
  constructor(reason: string) {
    super(reason, 422, IMPORT_ERROR_CODES.CONNECTOR_INVALID);
    this.name = 'ImportConnectorInvalidError';
  }
}

export interface IngestLeadImportInput {
  readonly csv: string;
  readonly connectorId: string;
  readonly dryRun: boolean;
  /** Optional pool id; when set, out-of-pool ownerUserIds become `owner_out_of_scope`. */
  readonly scopeToPoolId?: string | null;
}

export interface IngestLeadImportResult {
  readonly summary: ImportSummary;
  readonly rows: readonly ImportRowResult[];
  readonly committed: number;
  readonly skippedOnCommit: number;
  readonly commitErrors: ReadonlyArray<{ rowKey: string; error: string }>;
}

function assertSuperAdmin(ctx: RequestContext): void {
  if (ctx.principal.accountType !== 'super-admin') {
    throw new PlatformForbiddenError('Lead imports are restricted to Super Admin');
  }
}

async function loadConnector(ctx: RequestContext, connectorId: string): Promise<{ status: string }> {
  const row = await db.maybeOne<{ status: string }>(
    ctx,
    sql`SELECT status FROM sales_connector WHERE id = ${connectorId} AND kind = 'import'`,
  );
  if (!row) throw new ImportConnectorInvalidError('Import connector not found');
  if (row.status !== 'active') throw new ImportConnectorInvalidError(`Connector is ${row.status}, not active`);
  return row;
}

async function loadValidationContext(
  ctx: RequestContext,
  scopeToPoolId: string | null | undefined,
): Promise<RowValidationContext> {
  const sources = await db.query<{ id: string; name: string }>(
    ctx,
    sql`SELECT id, name FROM lead_source WHERE organization_id = ${ctx.organizationId} AND status = 'active'`,
  );
  const knownSourceByName = new Map(sources.map((s) => [s.name.toLowerCase(), s.id]));
  const existing = await db.query<{ phone: string | null; email: string | null }>(
    ctx,
    sql`SELECT primary_phone AS "phone", primary_email AS "email" FROM contact WHERE organization_id = ${ctx.organizationId}`,
  );
  const existingContactKeys = new Set<string>();
  for (const row of existing) {
    if (row.phone) existingContactKeys.add(row.phone.toLowerCase());
    if (row.email) existingContactKeys.add(row.email.toLowerCase());
  }
  let inScopeOwnerUserIds: Set<string> | null = null;
  if (scopeToPoolId) {
    const members = await db.query<{ id: string }>(
      ctx,
      sql`SELECT id FROM app_user WHERE organization_id = ${ctx.organizationId} AND team_id = ${scopeToPoolId} AND status = 'active'`,
    );
    inScopeOwnerUserIds = new Set(members.map((m) => m.id));
  }
  return { knownSourceByName, existingContactKeys, inScopeOwnerUserIds };
}

function buildIntakePayload(
  connectorId: string,
  row: ImportRowResult,
): IntakePayload {
  const mapped: Record<string, unknown> = {
    contactName: row.record['contactName'] ?? row.record['contact_name'] ?? null,
    phoneRaw: row.normalizedPhone,
    emailRaw: row.normalizedEmail,
    companyName: row.record['companyName'] ?? row.record['company_name'] ?? null,
    serviceRequested: row.record['serviceRequested'] ?? row.record['service_requested'] ?? null,
    location: row.record['location'] ?? null,
    budgetBracket: row.record['budgetBracket'] ?? row.record['budget_bracket'] ?? null,
    message: row.record['message'] ?? null,
  };
  return {
    connectorId,
    externalLeadId: row.rowKey,
    mappedFields: mapped as IntakePayload['mappedFields'],
  };
}

export async function ingestLeadImport(
  ctx: RequestContext,
  input: IngestLeadImportInput,
): Promise<IngestLeadImportResult> {
  assertSuperAdmin(ctx);
  if (input.csv.length === 0) {
    return {
      summary: { total: 0, valid: 0, invalid: 0, byStatus: {
        valid: 0, invalid_contact: 0, duplicate: 0,
        unknown_source: 0, owner_out_of_scope: 0, missing_routing_attributes: 0,
      } },
      rows: [],
      committed: 0,
      skippedOnCommit: 0,
      commitErrors: [],
    };
  }

  await loadConnector(ctx, input.connectorId);

  const parsed = parseCsv(input.csv);
  const records = toRecords(parsed);
  if (records.length > IMPORT_LIMITS.MAX_ROWS) throw new ImportTooManyRowsError(records.length);

  const validationCtx = await loadValidationContext(ctx, input.scopeToPoolId);
  const { results, summary } = validateRows(records, validationCtx);

  if (input.dryRun) {
    return { summary, rows: results, committed: 0, skippedOnCommit: 0, commitErrors: [] };
  }

  let committed = 0;
  let skippedOnCommit = 0;
  const commitErrors: Array<{ rowKey: string; error: string }> = [];
  for (const row of results) {
    if (row.status !== 'valid') {
      skippedOnCommit++;
      continue;
    }
    try {
      await ingest(ctx, buildIntakePayload(input.connectorId, row));
      committed++;
    } catch (err) {
      commitErrors.push({ rowKey: row.rowKey, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { summary, rows: results, committed, skippedOnCommit, commitErrors };
}
