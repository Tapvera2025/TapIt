import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { ImportField } from './mapping.js';
import type { ImportSourceKind } from './table.js';
import type {
  AssigneeOption,
  ImportedLeadItem,
  ImportRowStatus,
  ImportRowView,
  ImportSettings,
  ImportStatus,
  LeadImportSummary,
} from './types.js';
import type { ImportedLeadsFilter, ImportRowsQuery } from './validators.js';

/* ==================================================================== *
 * Imports
 * ==================================================================== */

export interface ImportRecord {
  readonly id: string;
  readonly name: string;
  readonly sourceKind: ImportSourceKind;
  readonly fileName: string | null;
  readonly sheetName: string | null;
  readonly status: ImportStatus;
  readonly headers: string[];
  readonly columnMapping: Record<string, ImportField>;
  readonly assigneeMapping: Record<string, string | null>;
  readonly leadSourceId: string | null;
  readonly campaignId: string | null;
  readonly defaultCountryCode: string | null;
  readonly extraColumnsToNotes: boolean;
  readonly totalRows: number;
  readonly createdBy: string;
  readonly startedBy: string | null;
  readonly heartbeatAt: Date | null;
}

const RECORD_COLUMNS = sql`
  i.id, i.name, i.source_kind AS "sourceKind", i.file_name AS "fileName", i.sheet_name AS "sheetName",
  i.status, i.headers, i.column_mapping AS "columnMapping", i.assignee_mapping AS "assigneeMapping",
  i.lead_source_id AS "leadSourceId", i.campaign_id AS "campaignId",
  i.default_country_code AS "defaultCountryCode", i.extra_columns_to_notes AS "extraColumnsToNotes",
  i.total_rows AS "totalRows", i.created_by AS "createdBy", i.started_by AS "startedBy",
  i.heartbeat_at AS "heartbeatAt"`;

export async function findImportRecord(ctx: RequestContext, id: string): Promise<ImportRecord | null> {
  return db.maybeOne<ImportRecord>(ctx, sql`SELECT ${RECORD_COLUMNS} FROM lead_import i WHERE i.organization_id = ${ctx.organizationId} AND i.id = ${id}`);
}

const SUMMARY_SELECT = sql`
  SELECT i.id, i.name, i.source_kind AS "sourceKind", i.file_name AS "fileName", i.sheet_name AS "sheetName",
         i.status, i.total_rows AS "totalRows", i.processed_rows AS "processedRows",
         i.created_count AS "createdCount", i.existing_count AS "existingCount",
         i.duplicate_count AS "duplicateCount", i.invalid_count AS "invalidCount", i.failed_count AS "failedCount",
         COALESCE(owned.assigned, 0)::int AS "assignedCount",
         COALESCE(owned.unassigned, 0)::int AS "unassignedCount",
         i.lead_source_id AS "leadSourceId", src.name AS "leadSourceName",
         i.campaign_id AS "campaignId", camp.name AS "campaignName",
         i.created_by AS "createdBy", creator.full_name AS "createdByName",
         i.created_at AS "createdAt", i.started_at AS "startedAt", i.completed_at AS "completedAt",
         i.last_error AS "lastError"
    FROM lead_import i
    LEFT JOIN lead_source src ON src.organization_id = i.organization_id AND src.id = i.lead_source_id
    LEFT JOIN campaign camp ON camp.organization_id = i.organization_id AND camp.id = i.campaign_id
    LEFT JOIN app_user creator ON creator.organization_id = i.organization_id AND creator.id = i.created_by
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE l.owner_id IS NOT NULL) AS assigned,
             count(*) FILTER (WHERE l.owner_id IS NULL) AS unassigned
        FROM lead_import_row r
        JOIN lead l ON l.organization_id = r.organization_id AND l.id = r.lead_id
       WHERE r.organization_id = i.organization_id AND r.import_id = i.id AND r.status = 'created'
    ) owned ON true`;

export async function findImportSummary(ctx: RequestContext, id: string): Promise<LeadImportSummary | null> {
  return db.maybeOne<LeadImportSummary>(ctx, sql`${SUMMARY_SELECT} WHERE i.organization_id = ${ctx.organizationId} AND i.id = ${id}`);
}

export async function listImportSummaries(ctx: RequestContext, limit: number): Promise<LeadImportSummary[]> {
  return db.query<LeadImportSummary>(
    ctx,
    sql`${SUMMARY_SELECT}
        WHERE i.organization_id = ${ctx.organizationId} AND i.status <> 'cancelled'
          AND (i.status <> 'draft' OR i.created_at > now() - interval '1 day')
        ORDER BY i.created_at DESC
        LIMIT ${limit}`,
  );
}

export interface NewImport {
  readonly name: string;
  readonly kind: ImportSourceKind;
  readonly fileName: string | null;
  readonly sourceUrl: string | null;
  readonly sheetName: string | null;
  readonly digest: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly settings: ImportSettings;
}

/** A draft import with its rows, in one transaction. */
export async function insertDraftImport(ctx: RequestContext, input: NewImport): Promise<string> {
  return db.transaction(ctx, async (tx) => {
    const created = await tx.one<{ id: string }>(sql`
      INSERT INTO lead_import (
        organization_id, name, source_kind, file_name, source_url, sheet_name, file_digest,
        headers, column_mapping, assignee_mapping, lead_source_id, campaign_id, default_country_code,
        extra_columns_to_notes, total_rows, created_by
      ) VALUES (
        ${ctx.organizationId}, ${input.name}, ${input.kind}, ${input.fileName}, ${input.sourceUrl}, ${input.sheetName}, ${input.digest},
        ${[...input.headers]}::text[], ${JSON.stringify(input.settings.columnMapping)}::jsonb, ${JSON.stringify(input.settings.assigneeMapping)}::jsonb,
        ${input.settings.leadSourceId}, ${input.settings.campaignId}, ${input.settings.defaultCountryCode},
        ${input.settings.extraColumnsToNotes}, ${input.rows.length}, ${ctx.principal.id}
      )
      RETURNING id`);
    for (let start = 0; start < input.rows.length; start += 500) {
      const batch = input.rows.slice(start, start + 500);
      const values = batch.map((cells, index) => sql`(${ctx.organizationId}::uuid, ${created.id}::uuid, ${start + index + 1}::int, ${[...cells]}::text[])`);
      await tx.query(sql`INSERT INTO lead_import_row (organization_id, import_id, row_number, cells) VALUES ${sql.join(values)}`);
    }
    return created.id;
  });
}

export async function updateDraftSettings(ctx: RequestContext, id: string, settings: ImportSettings): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`UPDATE lead_import
           SET name = ${settings.name},
               column_mapping = ${JSON.stringify(settings.columnMapping)}::jsonb,
               assignee_mapping = ${JSON.stringify(settings.assigneeMapping)}::jsonb,
               lead_source_id = ${settings.leadSourceId},
               campaign_id = ${settings.campaignId},
               default_country_code = ${settings.defaultCountryCode},
               extra_columns_to_notes = ${settings.extraColumnsToNotes}
         WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND status = 'draft'
        RETURNING id`,
  );
  return rows.length === 1;
}

/** draft → queued, with the final settings. False when it was not a draft. */
export async function queueImport(ctx: RequestContext, id: string, settings: ImportSettings): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`UPDATE lead_import
           SET name = ${settings.name},
               column_mapping = ${JSON.stringify(settings.columnMapping)}::jsonb,
               assignee_mapping = ${JSON.stringify(settings.assigneeMapping)}::jsonb,
               lead_source_id = ${settings.leadSourceId},
               campaign_id = ${settings.campaignId},
               default_country_code = ${settings.defaultCountryCode},
               extra_columns_to_notes = ${settings.extraColumnsToNotes},
               status = 'queued', started_by = ${ctx.principal.id}, started_at = now(), last_error = NULL
         WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND status = 'draft'
        RETURNING id`,
  );
  return rows.length === 1;
}

/** A failed import picks up where it stopped. */
export async function requeueFailedImport(ctx: RequestContext, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`UPDATE lead_import SET status = 'queued', last_error = NULL
         WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND status = 'failed'
        RETURNING id`,
  );
  return rows.length === 1;
}

/**
 * Take the import for this run. A queued import is free; one already
 * importing is taken over only when its job stopped sending heartbeats.
 */
export async function claimImport(ctx: RequestContext, id: string, staleAfterMs: number): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`UPDATE lead_import SET status = 'importing', heartbeat_at = now()
         WHERE organization_id = ${ctx.organizationId} AND id = ${id}
           AND (status = 'queued'
                OR (status = 'importing' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => ${staleAfterMs / 1000}))))
        RETURNING id`,
  );
  return rows.length === 1;
}

/** Recount from the rows (exact after any crash) and touch the heartbeat. */
export async function refreshImportProgress(ctx: RequestContext, id: string): Promise<void> {
  await db.query(
    ctx,
    sql`UPDATE lead_import i
           SET processed_rows = counts.processed, created_count = counts.created, existing_count = counts.existing,
               duplicate_count = counts.duplicate, invalid_count = counts.invalid, failed_count = counts.failed,
               heartbeat_at = now()
          FROM (
            SELECT count(*) FILTER (WHERE status <> 'pending')::int AS processed,
                   count(*) FILTER (WHERE status = 'created')::int AS created,
                   count(*) FILTER (WHERE status = 'existing')::int AS existing,
                   count(*) FILTER (WHERE status = 'duplicate')::int AS duplicate,
                   count(*) FILTER (WHERE status = 'invalid')::int AS invalid,
                   count(*) FILTER (WHERE status = 'failed')::int AS failed
              FROM lead_import_row
             WHERE organization_id = ${ctx.organizationId} AND import_id = ${id}
          ) counts
         WHERE i.organization_id = ${ctx.organizationId} AND i.id = ${id}`,
  );
}

export async function finishImport(ctx: RequestContext, id: string, status: 'completed' | 'failed', error: string | null): Promise<void> {
  await db.query(
    ctx,
    sql`UPDATE lead_import
           SET status = ${status}, last_error = ${error}, heartbeat_at = NULL,
               completed_at = CASE WHEN ${status} = 'completed' THEN now() ELSE completed_at END
         WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND status = 'importing'`,
  );
}

export async function discardDraft(ctx: RequestContext, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`UPDATE lead_import SET status = 'cancelled'
         WHERE organization_id = ${ctx.organizationId} AND id = ${id} AND status = 'draft'
        RETURNING id`,
  );
  return rows.length === 1;
}

export async function loadRowCells(ctx: RequestContext, importId: string, limit: number): Promise<Array<{ rowNumber: number; cells: string[] }>> {
  return db.query(
    ctx,
    sql`SELECT row_number AS "rowNumber", cells FROM lead_import_row
         WHERE organization_id = ${ctx.organizationId} AND import_id = ${importId}
         ORDER BY row_number LIMIT ${limit}`,
  );
}

export interface PendingRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly cells: string[];
}

export async function pendingRows(ctx: RequestContext, importId: string, limit: number): Promise<PendingRow[]> {
  return db.query<PendingRow>(
    ctx,
    sql`SELECT id, row_number AS "rowNumber", cells FROM lead_import_row
         WHERE organization_id = ${ctx.organizationId} AND import_id = ${importId} AND status = 'pending'
         ORDER BY row_number LIMIT ${limit}`,
  );
}

export interface RowOutcome {
  readonly status: Exclude<ImportRowStatus, 'pending'>;
  readonly reason: string | null;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly assigneeValue: string | null;
  readonly leadId: string | null;
  readonly submissionId: string | null;
}

export async function saveRowOutcome(executor: Tx | RequestContext, organizationId: string, rowId: string, outcome: RowOutcome): Promise<void> {
  const statement = sql`
    UPDATE lead_import_row
       SET status = ${outcome.status}, reason = ${outcome.reason}, contact_name = ${outcome.contactName},
           phone = ${outcome.phone}, email = ${outcome.email}, assignee_value = ${outcome.assigneeValue},
           lead_id = ${outcome.leadId}, submission_id = ${outcome.submissionId}, processed_at = now()
     WHERE organization_id = ${organizationId} AND id = ${rowId} AND status = 'pending'`;
  if ('principal' in executor) await db.query(executor, statement);
  else await executor.query(statement);
}

/** Was this lead created by an earlier row of the same import? */
export async function leadCreatedByImport(ctx: RequestContext, importId: string, leadId: string): Promise<boolean> {
  const row = await db.maybeOne<{ id: string }>(
    ctx,
    sql`SELECT id FROM lead_import_row
         WHERE organization_id = ${ctx.organizationId} AND import_id = ${importId} AND lead_id = ${leadId} AND status = 'created'
         LIMIT 1`,
  );
  return row !== null;
}

/** Rows that created a lead and named someone in "Assigned to", not yet handed out. */
export async function sheetAssignments(ctx: RequestContext, importId: string): Promise<Array<{ leadId: string; assigneeValue: string }>> {
  return db.query(
    ctx,
    sql`SELECT r.lead_id AS "leadId", r.assignee_value AS "assigneeValue"
          FROM lead_import_row r
          JOIN lead l ON l.organization_id = r.organization_id AND l.id = r.lead_id
         WHERE r.organization_id = ${ctx.organizationId} AND r.import_id = ${importId}
           AND r.status = 'created' AND r.assignee_value IS NOT NULL AND r.assigned_to IS NULL
           AND l.owner_id IS NULL
         ORDER BY r.row_number`,
  );
}

export async function listImportRows(ctx: RequestContext, importId: string, query: ImportRowsQuery): Promise<{ items: ImportRowView[]; total: number }> {
  const statusFilter =
    query.status === 'all'
      ? sql`TRUE`
      : query.status === 'problems'
        ? sql`r.status IN ('invalid', 'failed', 'existing', 'duplicate')`
        : sql`r.status = ${query.status}`;
  const where = sql`r.organization_id = ${ctx.organizationId} AND r.import_id = ${importId} AND ${statusFilter}`;
  const [items, total] = await Promise.all([
    db.query<ImportRowView>(
      ctx,
      sql`SELECT r.row_number AS "rowNumber", r.status, r.reason, r.contact_name AS "contactName", r.phone, r.email,
                 r.assignee_value AS "assigneeValue", r.lead_id AS "leadId", l.lead_number::text AS "leadNumber",
                 owner.full_name AS "ownerName"
            FROM lead_import_row r
            LEFT JOIN lead l ON l.organization_id = r.organization_id AND l.id = r.lead_id
            LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id
           WHERE ${where}
           ORDER BY r.row_number
           LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ),
    db.one<{ total: number }>(ctx, sql`SELECT count(*)::int AS total FROM lead_import_row r WHERE ${where}`),
  ]);
  return { items, total: total.total };
}

/* ==================================================================== *
 * Defaults, sources, people
 * ==================================================================== */

export async function organizationTimeZone(ctx: RequestContext): Promise<string> {
  const row = await db.maybeOne<{ timezone: string }>(ctx, sql`SELECT timezone FROM organization WHERE id = ${ctx.organizationId}`);
  return row?.timezone ?? 'UTC';
}

export async function lastImportDefaults(ctx: RequestContext): Promise<{ leadSourceId: string | null; defaultCountryCode: string | null } | null> {
  return db.maybeOne(
    ctx,
    sql`SELECT lead_source_id AS "leadSourceId", default_country_code AS "defaultCountryCode"
          FROM lead_import
         WHERE organization_id = ${ctx.organizationId} AND status IN ('queued', 'importing', 'completed', 'failed')
         ORDER BY created_at DESC LIMIT 1`,
  );
}

export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly direction: 'inbound' | 'outbound';
  readonly status: 'active' | 'inactive';
}

export async function findLeadSource(ctx: RequestContext, id: string): Promise<SourceRow | null> {
  return db.maybeOne<SourceRow>(ctx, sql`SELECT id, name, direction, status FROM lead_source WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

export async function findCampaign(ctx: RequestContext, id: string): Promise<{ id: string; name: string; status: string } | null> {
  return db.maybeOne(ctx, sql`SELECT id, name, status FROM campaign WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
}

/**
 * The intake connector import leads arrive through. Intake attributes every
 * lead to its connector's source (and campaign), so there is one per source
 * and campaign pair, made on first use.
 */
export async function ensureImportConnector(
  ctx: RequestContext,
  input: { readonly source: SourceRow; readonly campaignId: string | null; readonly createdBy: string },
): Promise<string> {
  const accountId = `lead-imports:${input.source.id}:${input.campaignId ?? 'none'}`;
  const config = {
    sourceId: input.source.id,
    direction: input.source.direction,
    requireService: false,
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
  };
  const existing = await db.maybeOne<{ id: string; status: string }>(
    ctx,
    sql`SELECT id, status FROM sales_connector
         WHERE organization_id = ${ctx.organizationId} AND kind = 'import' AND external_account_id = ${accountId}`,
  );
  if (existing) {
    if (existing.status !== 'active') {
      await db.query(ctx, sql`UPDATE sales_connector SET status = 'active', config = ${JSON.stringify(config)}::jsonb WHERE organization_id = ${ctx.organizationId} AND id = ${existing.id}`);
    }
    return existing.id;
  }
  const name = `Lead import · ${input.source.name}`.slice(0, 120);
  await db.query(
    ctx,
    sql`INSERT INTO sales_connector (organization_id, kind, name, external_account_id, config, status, created_by)
        VALUES (${ctx.organizationId}, 'import', ${name}, ${accountId}, ${JSON.stringify(config)}::jsonb, 'active', ${input.createdBy})
        ON CONFLICT (organization_id, kind, external_account_id) WHERE external_account_id IS NOT NULL DO NOTHING`,
  );
  const created = await db.one<{ id: string }>(
    ctx,
    sql`SELECT id FROM sales_connector WHERE organization_id = ${ctx.organizationId} AND kind = 'import' AND external_account_id = ${accountId}`,
  );
  return created.id;
}

/** Fields the intake pipeline does not carry, written once on the new lead. */
export async function writeImportedLeadDetails(
  tx: Tx,
  organizationId: string,
  leadId: string,
  details: { requirement: string | null; location: string | null; language: string | null; notes: string | null },
): Promise<void> {
  await tx.query(sql`
    UPDATE lead
       SET requirement = COALESCE(requirement, ${details.requirement}),
           location = COALESCE(location, ${details.location}),
           language_preference = COALESCE(language_preference, ${details.language}),
           intake_notes = COALESCE(intake_notes, ${details.notes})
     WHERE organization_id = ${organizationId} AND id = ${leadId}`);
}

/** Existing contacts behind these phones and emails, with their open lead if any. */
export async function findExistingContacts(
  ctx: RequestContext,
  phones: readonly string[],
  emails: readonly string[],
): Promise<Array<{ phone: string | null; email: string | null; leadNumber: string | null; ownerName: string | null }>> {
  if (phones.length === 0 && emails.length === 0) return [];
  return db.query(
    ctx,
    sql`SELECT c.primary_phone AS phone, lower(c.primary_email::text) AS email,
               open_lead.lead_number AS "leadNumber", open_lead.owner_name AS "ownerName"
          FROM contact c
          LEFT JOIN LATERAL (
            SELECT l.lead_number::text AS lead_number, owner.full_name AS owner_name
              FROM lead l
              LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id
             WHERE l.organization_id = c.organization_id AND l.contact_id = c.id AND l.lead_outcome = 'active'
             ORDER BY l.created_at DESC LIMIT 1
          ) open_lead ON true
         WHERE c.organization_id = ${ctx.organizationId}
           AND (c.primary_phone = ANY(${[...phones]}::text[]) OR lower(c.primary_email::text) = ANY(${[...emails]}::text[]))`,
  );
}

const SALES_POSITION_CODES = ['sales-head', 'sales-team-lead', 'sales-supervisor', 'sales-agent'];

/** Active employees in the Sales department (or holding a Sales position). */
export async function listSalesEmployees(ctx: RequestContext): Promise<Array<Omit<AssigneeOption, 'availability'>>> {
  return db.query(
    ctx,
    sql`SELECT u.id, u.full_name AS "fullName", u.email::text AS email, p.name AS "positionName", t.name AS "teamName",
               COALESCE(open_leads.count, 0)::int AS "openLeads"
          FROM app_user u
          LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
          LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
          LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
          LEFT JOIN LATERAL (
            SELECT count(*) AS count FROM lead l
             WHERE l.organization_id = u.organization_id AND l.owner_id = u.id AND l.lead_outcome = 'active'
          ) open_leads ON true
         WHERE u.organization_id = ${ctx.organizationId}
           AND u.account_type = 'employee'
           AND u.status = 'active'
           AND (d.code = 'sales' OR p.code = ANY(${SALES_POSITION_CODES}::text[]))
         ORDER BY u.full_name`,
  );
}

/* ==================================================================== *
 * Imported leads
 * ==================================================================== */

/**
 * Calls with the lead's number since it was assigned, split by whether its
 * owner made or took them (through their matched JustCall/Aircall user).
 * Numbers match on their last ten digits. Needs `l` (lead) in scope.
 */
export const CALL_STATS_LATERAL = sql`
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE a.employee_id = l.owner_id)::int AS owner_calls,
           count(*) FILTER (WHERE a.employee_id = l.owner_id AND c.direction = 'outbound')::int AS attempts,
           count(*) FILTER (WHERE a.employee_id = l.owner_id AND c.outcome = 'answered')::int AS connected_calls,
           count(*) FILTER (WHERE a.employee_id IS DISTINCT FROM l.owner_id)::int AS other_calls,
           min(c.started_at) FILTER (WHERE a.employee_id = l.owner_id) AS first_call_at,
           max(c.started_at) FILTER (WHERE a.employee_id = l.owner_id) AS last_call_at,
           COALESCE(sum(c.talk_seconds) FILTER (WHERE a.employee_id = l.owner_id), 0)::int AS talk_seconds,
           (array_agg(c.outcome ORDER BY c.started_at DESC) FILTER (WHERE a.employee_id = l.owner_id))[1] AS last_outcome
      FROM telephony_call c
      LEFT JOIN telephony_agent a ON a.organization_id = c.organization_id AND a.id = c.agent_id
     WHERE l.owner_id IS NOT NULL
       AND l.assigned_at IS NOT NULL
       AND length(COALESCE(l.phone_normalized, '')) >= 7
       AND c.organization_id = l.organization_id
       AND c.contact_number IS NOT NULL
       AND right(c.contact_number, 10) = right(l.phone_normalized, 10)
       AND c.started_at >= l.assigned_at
  ) cs ON true`;

export const CALL_STATUS = sql`
  CASE WHEN l.owner_id IS NULL THEN NULL
       WHEN length(COALESCE(l.phone_normalized, '')) < 7 THEN 'no_phone'
       WHEN cs.connected_calls > 0 THEN 'connected'
       WHEN cs.owner_calls > 0 THEN 'no_answer'
       WHEN cs.other_calls > 0 THEN 'other'
       ELSE 'not_called' END`;

export const IMPORTED_FROM = sql`
  FROM lead_import_row r
  JOIN lead_import i ON i.organization_id = r.organization_id AND i.id = r.import_id
  JOIN lead l ON l.organization_id = r.organization_id AND l.id = r.lead_id
  LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id
  LEFT JOIN team owner_team ON owner_team.organization_id = owner.organization_id AND owner_team.id = owner.team_id
  LEFT JOIN app_user assigner ON assigner.organization_id = r.organization_id AND assigner.id = r.assigned_by`;

export function importedWhere(ctx: RequestContext, filter: ImportedLeadsFilter, options: { assignment?: boolean } = {}): SqlFragment {
  const parts: SqlFragment[] = [sql`r.organization_id = ${ctx.organizationId}`, sql`r.status = 'created'`];
  if (filter.importId) parts.push(sql`r.import_id = ${filter.importId}`);
  if (options.assignment !== false) {
    if (filter.assignment === 'unassigned') parts.push(sql`l.owner_id IS NULL`);
    if (filter.assignment === 'assigned') parts.push(sql`l.owner_id IS NOT NULL`);
  }
  if (filter.ownerId) parts.push(sql`l.owner_id = ${filter.ownerId}`);
  if (filter.search) {
    const pattern = `%${filter.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const digits = filter.search.replace(/\D/g, '');
    parts.push(
      digits.length >= 4
        ? sql`(l.contact_name ILIKE ${pattern} OR l.company_name ILIKE ${pattern} OR l.phone_normalized LIKE ${`%${digits}%`} OR l.email::text ILIKE ${pattern})`
        : sql`(l.contact_name ILIKE ${pattern} OR l.company_name ILIKE ${pattern} OR l.email::text ILIKE ${pattern} OR owner.full_name ILIKE ${pattern})`,
    );
  }
  return sql.join(parts, ' AND ');
}

const IMPORTED_COLUMNS = sql`
  l.id AS "leadId", l.lead_number::text AS "leadNumber", l.contact_name AS "contactName", l.company_name AS "companyName",
  l.phone, l.email::text AS email, l.status AS "leadStatus", r.import_id AS "importId", i.name AS "importName",
  r.row_number AS "rowNumber", l.owner_id AS "ownerId", owner.full_name AS "ownerName", owner_team.name AS "ownerTeamName",
  CASE WHEN l.owner_id IS NULL THEN NULL ELSE l.assigned_at END AS "assignedAt",
  CASE WHEN r.assigned_to = l.owner_id THEN assigner.full_name END AS "assignedByName",
  CASE WHEN r.assigned_to = l.owner_id THEN r.assigned_via END AS "assignedVia",
  l.created_at AS "createdAt"`;

export async function listImportedLeads(
  ctx: RequestContext,
  filter: ImportedLeadsFilter,
  page: { readonly page: number; readonly pageSize: number },
  withCalls: boolean,
): Promise<{ items: ImportedLeadItem[]; total: number }> {
  const where = importedWhere(ctx, filter);
  const offset = (page.page - 1) * page.pageSize;
  const callColumns = withCalls
    ? sql`${CALL_STATUS} AS "callStatus", COALESCE(cs.attempts, 0)::int AS "callAttempts", cs.last_call_at AS "lastCallAt"`
    : sql`NULL::text AS "callStatus", 0 AS "callAttempts", NULL::timestamptz AS "lastCallAt"`;
  const lateral = withCalls ? CALL_STATS_LATERAL : sql``;
  const callFilter = withCalls && filter.callStatus ? sql`AND ${CALL_STATUS} = ${filter.callStatus}` : sql``;

  const items = await db.query<ImportedLeadItem>(
    ctx,
    sql`SELECT ${IMPORTED_COLUMNS}, ${callColumns}
          ${IMPORTED_FROM}
          ${lateral}
         WHERE ${where} ${callFilter}
         ORDER BY r.created_at DESC, r.row_number
         LIMIT ${page.pageSize} OFFSET ${offset}`,
  );
  const total = await db.one<{ total: number }>(
    ctx,
    sql`SELECT count(*)::int AS total ${IMPORTED_FROM} ${lateral} WHERE ${where} ${callFilter}`,
  );
  return { items, total: total.total };
}

export async function importedCounts(ctx: RequestContext, filter: ImportedLeadsFilter): Promise<{ all: number; unassigned: number; assigned: number }> {
  return db.one(
    ctx,
    sql`SELECT count(*)::int AS "all",
               count(*) FILTER (WHERE l.owner_id IS NULL)::int AS unassigned,
               count(*) FILTER (WHERE l.owner_id IS NOT NULL)::int AS assigned
          ${IMPORTED_FROM}
         WHERE ${importedWhere(ctx, filter, { assignment: false })}`,
  );
}

/** Lead ids matching the Imported leads filters, oldest import row first. */
export async function importedLeadIds(ctx: RequestContext, filter: ImportedLeadsFilter, withCalls: boolean, limit: number): Promise<string[]> {
  const lateral = withCalls && filter.callStatus ? CALL_STATS_LATERAL : sql``;
  const callFilter = withCalls && filter.callStatus ? sql`AND ${CALL_STATUS} = ${filter.callStatus}` : sql``;
  const rows = await db.query<{ leadId: string }>(
    ctx,
    sql`SELECT l.id AS "leadId" ${IMPORTED_FROM} ${lateral}
         WHERE ${importedWhere(ctx, filter)} ${callFilter}
         ORDER BY r.created_at, r.row_number
         LIMIT ${limit}`,
  );
  return rows.map((row) => row.leadId);
}

/* ==================================================================== *
 * Telephony state for call tracking
 * ==================================================================== */

export async function telephonyConnections(ctx: RequestContext): Promise<{ connected: boolean; lastSyncAt: string | null }> {
  return db.one(
    ctx,
    sql`SELECT count(*) FILTER (WHERE tc.status <> 'disconnected') > 0 AS connected,
               max(tc.last_sync_finished_at) AS "lastSyncAt"
          FROM telephony_connection tc
         WHERE tc.organization_id = ${ctx.organizationId}`,
  );
}
