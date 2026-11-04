/**
 * Are assigned leads being called? For every imported lead with an owner,
 * the JustCall/Aircall calls with its number since it was assigned, split by
 * whether the owner made them. One round trip: the matched set is computed
 * once (a materialized CTE) and summarized three ways — totals, per person and
 * the page of leads.
 */

import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { ImportNotFoundError } from './errors.js';
import { CALL_STATS_LATERAL, CALL_STATUS, IMPORTED_FROM } from './repository.js';
import type { CallTrackingEmployee, CallTrackingLead, CallTrackingTotals, LeadCallHistory, LeadCallMatch } from './types.js';
import type { CallTrackingQuery } from './validators.js';

/** Not called by the assignee a day after assignment. */
const OVERDUE = sql`interval '1 day'`;

function trackedWhere(ctx: RequestContext, query: CallTrackingQuery, timeZone: string): SqlFragment {
  const parts: SqlFragment[] = [sql`r.organization_id = ${ctx.organizationId}`, sql`r.status = 'created'`, sql`l.owner_id IS NOT NULL`, sql`l.assigned_at IS NOT NULL`];
  if (query.importId) parts.push(sql`r.import_id = ${query.importId}`);
  if (query.ownerId) parts.push(sql`l.owner_id = ${query.ownerId}`);
  if (query.assignedBy === 'me') parts.push(sql`r.assigned_by = ${ctx.principal.id} AND r.assigned_to = l.owner_id`);
  if (query.from) parts.push(sql`l.assigned_at >= (${query.from}::date)::timestamp AT TIME ZONE ${timeZone}`);
  if (query.to) parts.push(sql`l.assigned_at < ((${query.to}::date + 1))::timestamp AT TIME ZONE ${timeZone}`);
  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    const digits = query.search.replace(/\D/g, '');
    parts.push(
      digits.length >= 4
        ? sql`(l.contact_name ILIKE ${pattern} OR l.company_name ILIKE ${pattern} OR l.phone_normalized LIKE ${`%${digits}%`})`
        : sql`(l.contact_name ILIKE ${pattern} OR l.company_name ILIKE ${pattern} OR owner.full_name ILIKE ${pattern})`,
    );
  }
  return sql.join(parts, ' AND ');
}

const ORDER: Readonly<Record<CallTrackingQuery['sort'], { readonly rows: SqlFragment; readonly page: SqlFragment }>> = {
  assigned_desc: { rows: sql`t."assignedAt" DESC, t."leadId" DESC`, page: sql`page."assignedAt" DESC, page."leadId" DESC` },
  assigned_asc: { rows: sql`t."assignedAt" ASC, t."leadId" ASC`, page: sql`page."assignedAt" ASC, page."leadId" ASC` },
  last_call_desc: {
    rows: sql`t."lastCallAt" DESC NULLS LAST, t."assignedAt" DESC, t."leadId" DESC`,
    page: sql`page."lastCallAt" DESC NULLS LAST, page."assignedAt" DESC, page."leadId" DESC`,
  },
  // Uncalled leads that have waited longest first.
  waiting_longest: {
    rows: sql`(t.status IN ('not_called', 'other')) DESC, t."assignedAt" ASC, t."leadId" ASC`,
    page: sql`(page.status IN ('not_called', 'other')) DESC, page."assignedAt" ASC, page."leadId" ASC`,
  },
};

export interface TrackingResult {
  readonly totals: CallTrackingTotals;
  readonly employees: CallTrackingEmployee[];
  readonly leads: CallTrackingLead[];
  readonly total: number;
}

export async function callTracking(ctx: RequestContext, query: CallTrackingQuery, timeZone: string): Promise<TrackingResult> {
  const statusFilter = query.status === 'all' ? sql`TRUE` : sql`t.status = ${query.status}`;
  const offset = (query.page - 1) * query.pageSize;
  const row = await db.one<{ totals: CallTrackingTotals; employees: CallTrackingEmployee[]; leads: CallTrackingLead[]; total: number }>(
    ctx,
    sql`WITH tracked AS MATERIALIZED (
          SELECT l.id AS "leadId", l.lead_number::text AS "leadNumber", l.contact_name AS "contactName",
                 l.company_name AS "companyName", l.phone, r.import_id AS "importId", i.name AS "importName",
                 l.owner_id AS "ownerId", owner.full_name AS "ownerName", owner_team.name AS "teamName",
                 l.assigned_at AS "assignedAt",
                 CASE WHEN r.assigned_to = l.owner_id THEN assigner.full_name END AS "assignedByName",
                 ${CALL_STATUS} AS status,
                 COALESCE(cs.attempts, 0) AS attempts, COALESCE(cs.owner_calls, 0) AS "ownerCalls",
                 COALESCE(cs.connected_calls, 0) AS "connectedCalls", COALESCE(cs.other_calls, 0) AS "otherCalls",
                 cs.first_call_at AS "firstCallAt", cs.last_call_at AS "lastCallAt", cs.last_outcome AS "lastOutcome",
                 COALESCE(cs.talk_seconds, 0) AS "talkSeconds"
            ${IMPORTED_FROM}
            ${CALL_STATS_LATERAL}
           WHERE ${trackedWhere(ctx, query, timeZone)}
        ),
        totals AS (
          SELECT count(*)::int AS assigned,
                 count(*) FILTER (WHERE t.status <> 'no_phone')::int AS "withPhone",
                 count(*) FILTER (WHERE t."ownerCalls" > 0)::int AS called,
                 count(*) FILTER (WHERE t.status = 'connected')::int AS connected,
                 count(*) FILTER (WHERE t.status = 'no_answer')::int AS "noAnswer",
                 count(*) FILTER (WHERE t.status IN ('not_called', 'other'))::int AS "notCalled",
                 count(*) FILTER (WHERE t.status = 'other')::int AS "calledByOthers",
                 count(*) FILTER (WHERE t.status IN ('not_called', 'other') AND t."assignedAt" < now() - ${OVERDUE})::int AS overdue,
                 round(avg(extract(epoch FROM t."firstCallAt" - t."assignedAt")) FILTER (WHERE t."firstCallAt" IS NOT NULL))::float8 AS "avgFirstCallSeconds",
                 COALESCE(sum(t."talkSeconds"), 0)::int AS "talkSeconds"
            FROM tracked t
        ),
        people AS (
          SELECT t."ownerId" AS "employeeId", max(t."ownerName") AS "employeeName", max(t."teamName") AS "teamName",
                 count(*)::int AS assigned,
                 count(*) FILTER (WHERE t."ownerCalls" > 0)::int AS called,
                 count(*) FILTER (WHERE t.status = 'connected')::int AS connected,
                 count(*) FILTER (WHERE t.status IN ('not_called', 'other'))::int AS "notCalled",
                 count(*) FILTER (WHERE t.status IN ('not_called', 'other') AND t."assignedAt" < now() - ${OVERDUE})::int AS overdue,
                 round(avg(extract(epoch FROM t."firstCallAt" - t."assignedAt")) FILTER (WHERE t."firstCallAt" IS NOT NULL))::float8 AS "avgFirstCallSeconds",
                 COALESCE(sum(t."talkSeconds"), 0)::int AS "talkSeconds",
                 max(t."lastCallAt") AS "lastCallAt"
            FROM tracked t
           GROUP BY t."ownerId"
        ),
        page AS (
          SELECT t.* FROM tracked t WHERE ${statusFilter}
           ORDER BY ${ORDER[query.sort].rows}
           LIMIT ${query.pageSize} OFFSET ${offset}
        )
        SELECT (SELECT row_to_json(totals) FROM totals) AS totals,
               (SELECT COALESCE(json_agg(people ORDER BY people.assigned DESC, people."employeeName"), '[]'::json) FROM people) AS employees,
               (SELECT COALESCE(json_agg(page ORDER BY ${ORDER[query.sort].page}), '[]'::json) FROM page) AS leads,
               (SELECT count(*)::int FROM tracked t WHERE ${statusFilter}) AS total`,
  );
  return { totals: row.totals, employees: row.employees, leads: row.leads, total: row.total };
}

export async function leadCallHistory(ctx: RequestContext, leadId: string): Promise<LeadCallHistory> {
  const lead = await db.maybeOne<Omit<LeadCallHistory, 'calls'> & { phoneNormalized: string | null }>(
    ctx,
    sql`SELECT l.id AS "leadId", l.lead_number::text AS "leadNumber", l.contact_name AS "contactName", l.phone,
               l.phone_normalized AS "phoneNormalized", l.owner_id AS "ownerId", owner.full_name AS "ownerName",
               CASE WHEN l.owner_id IS NULL THEN NULL ELSE l.assigned_at END AS "assignedAt"
          FROM lead l
          LEFT JOIN app_user owner ON owner.organization_id = l.organization_id AND owner.id = l.owner_id
         WHERE l.organization_id = ${ctx.organizationId} AND l.id = ${leadId}
           AND EXISTS (SELECT 1 FROM lead_import_row r WHERE r.organization_id = l.organization_id AND r.lead_id = l.id AND r.status = 'created')`,
  );
  if (!lead) throw new ImportNotFoundError('Imported lead');
  const { phoneNormalized, ...view } = lead;
  if (!phoneNormalized || phoneNormalized.length < 7) return { ...view, calls: [] };
  const calls = await db.query<LeadCallMatch>(
    ctx,
    sql`SELECT c.id, c.provider, c.started_at AS "startedAt", c.direction, c.outcome, c.talk_seconds AS "talkSeconds",
               c.duration_seconds AS "durationSeconds", c.contact_number AS "contactNumber",
               a.employee_id AS "employeeId", COALESCE(emp.full_name, a.name) AS "employeeName",
               (a.employee_id IS NOT NULL AND a.employee_id = ${view.ownerId}::uuid) AS "byOwner",
               (${view.assignedAt}::timestamptz IS NOT NULL AND c.started_at >= ${view.assignedAt}::timestamptz) AS "afterAssignment",
               c.has_recording AS "hasRecording"
          FROM telephony_call c
          LEFT JOIN telephony_agent a ON a.organization_id = c.organization_id AND a.id = c.agent_id
          LEFT JOIN app_user emp ON emp.organization_id = a.organization_id AND emp.id = a.employee_id
         WHERE c.organization_id = ${ctx.organizationId}
           AND c.contact_number IS NOT NULL
           AND right(c.contact_number, 10) = right(${phoneNormalized}, 10)
         ORDER BY c.started_at DESC
         LIMIT 100`,
  );
  return { ...view, calls };
}
