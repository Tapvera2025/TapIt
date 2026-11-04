/**
 * Handing imported leads to the Sales team, many at once.
 *
 * Same effects as a single reassignment (leads/reassign.ts), done set-wise in
 * one transaction: owner and holder change, the lead takes the new owner's
 * pool and Sales Team (so their Supervisor, Team Lead and Sales Head see it),
 * pending callbacks follow it, and every lead gets its routing record,
 * activity and audit entry. People are told once per batch, not per lead.
 *
 * Availability is shown when picking people but does not block: a list is
 * often handed out the evening before it is worked.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { notify } from '../../notifications/facade.js';
import { ImportAssignError } from './errors.js';
import type { AssignedVia, AssignResult } from './types.js';

/** Round-robin in the order given: lead 1 → first person, lead 2 → second… */
export function distribute<T>(items: readonly T[], people: readonly string[]): Map<string, T[]> {
  const groups = new Map<string, T[]>(people.map((person) => [person, []]));
  items.forEach((item, index) => groups.get(people[index % people.length]!)!.push(item));
  return groups;
}

interface Assignee {
  readonly id: string;
  readonly fullName: string;
  readonly poolId: string | null;
  readonly teamId: string | null;
}

interface LockedLead {
  readonly leadId: string;
  readonly rowId: string;
  readonly importId: string;
  readonly importName: string;
  readonly ownerId: string | null;
  readonly closed: boolean;
}

const SALES_POSITION_CODES = ['sales-head', 'sales-team-lead', 'sales-supervisor', 'sales-agent'];

async function loadAssignees(ctx: RequestContext, employeeIds: readonly string[]): Promise<Assignee[]> {
  const unique = [...new Set(employeeIds)];
  const rows = await db.query<Assignee>(
    ctx,
    sql`SELECT u.id, u.full_name AS "fullName", u.team_id AS "poolId",
               CASE WHEN u.team_id IS NULL THEN NULL ELSE COALESCE(t.parent_team_id, u.team_id) END AS "teamId"
          FROM app_user u
          LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
          LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
          LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
         WHERE u.organization_id = ${ctx.organizationId}
           AND u.id = ANY(${unique}::uuid[])
           AND u.account_type = 'employee' AND u.status = 'active'
           AND (d.code = 'sales' OR p.code = ANY(${SALES_POSITION_CODES}::text[]))`,
  );
  if (rows.length !== unique.length) {
    throw new ImportAssignError('Leads can only go to active people in the Sales department. Refresh the list and pick again.', {
      unknown: unique.filter((id) => !rows.some((row) => row.id === id)),
    });
  }
  // Keep the order the person picked them in: it decides the round-robin.
  return unique.map((id) => rows.find((row) => row.id === id)!);
}

export interface AssignOptions {
  readonly leadIds: readonly string[];
  readonly employeeIds: readonly string[];
  readonly includeAssigned: boolean;
  readonly via: AssignedVia;
}

export async function assignImportedLeads(ctx: RequestContext, options: AssignOptions): Promise<AssignResult> {
  const assignees = await loadAssignees(ctx, options.employeeIds);
  const requested = [...new Set(options.leadIds)];

  const outcome = await db.transaction(ctx, async (tx) => {
    const locked = await tx.query<LockedLead>(sql`
      SELECT l.id AS "leadId", r.id AS "rowId", r.import_id AS "importId", i.name AS "importName", l.owner_id AS "ownerId",
             (l.lead_outcome <> 'active' OR l.status IN ('converted', 'closed_lost')) AS closed
        FROM lead l
        JOIN lead_import_row r ON r.organization_id = l.organization_id AND r.lead_id = l.id AND r.status = 'created'
        JOIN lead_import i ON i.organization_id = r.organization_id AND i.id = r.import_id
       WHERE l.organization_id = ${ctx.organizationId} AND l.id = ANY(${requested}::uuid[])
       ORDER BY r.import_id, r.row_number
       FOR UPDATE OF l`);

    const skipped = {
      notImported: requested.length - locked.length,
      closed: locked.filter((lead) => lead.closed).length,
      alreadyAssigned: 0,
    };
    const open = locked.filter((lead) => !lead.closed);
    const movable = options.includeAssigned ? open : open.filter((lead) => lead.ownerId === null);
    skipped.alreadyAssigned = open.length - movable.length;

    const groups = distribute(movable, assignees.map((assignee) => assignee.id));
    const byEmployee: Array<{ employeeId: string; fullName: string; count: number }> = [];
    const previousOwners = new Map<string, number>();
    let assigned = 0;
    let reassigned = 0;

    for (const assignee of assignees) {
      // Leads it already holds stay as they are.
      const leads = (groups.get(assignee.id) ?? []).filter((lead) => lead.ownerId !== assignee.id);
      if (leads.length === 0) {
        byEmployee.push({ employeeId: assignee.id, fullName: assignee.fullName, count: 0 });
        continue;
      }
      await applyAssignment(tx, ctx, assignee, leads, options.via);
      for (const lead of leads) {
        if (lead.ownerId) {
          reassigned++;
          if (lead.ownerId !== ctx.principal.id) previousOwners.set(lead.ownerId, (previousOwners.get(lead.ownerId) ?? 0) + 1);
        } else {
          assigned++;
        }
      }
      byEmployee.push({ employeeId: assignee.id, fullName: assignee.fullName, count: leads.length });

      const importNames = [...new Set(leads.map((lead) => lead.importName))];
      const from = importNames.length === 1 ? ` from “${importNames[0]}”` : '';
      await notify(tx, ctx, {
        type: 'lead.assigned',
        priority: 'operational',
        audience: { users: [assignee.id] },
        title: leads.length === 1 ? 'A lead was assigned to you' : `${leads.length} leads were assigned to you`,
        body: `You have ${leads.length === 1 ? 'a new lead' : `${leads.length} new leads`}${from}. They are in My Work, ready for a first call.`,
        link: '/company/sales/my-work',
        metadata: { count: leads.length, importId: importNames.length === 1 ? leads[0]!.importId : null, firstLeadId: leads[0]!.leadId },
      });
    }

    for (const [ownerId, count] of previousOwners) {
      if (assignees.some((assignee) => assignee.id === ownerId)) continue;
      await notify(tx, ctx, {
        type: 'lead.reassigned',
        priority: 'operational',
        audience: { users: [ownerId] },
        title: count === 1 ? 'A lead was reassigned' : `${count} of your leads were reassigned`,
        body: count === 1 ? 'An imported lead you held now belongs to someone else.' : `${count} imported leads you held now belong to other people.`,
        link: '/company/sales/leads',
        metadata: { count },
      });
    }

    return { assigned, reassigned, skipped, byEmployee };
  });
  return outcome;
}

async function applyAssignment(tx: Tx, ctx: RequestContext, assignee: Assignee, leads: readonly LockedLead[], via: AssignedVia): Promise<void> {
  const leadIds = leads.map((lead) => lead.leadId);
  const previous = leads.map((lead) => lead.ownerId);
  const importIds = leads.map((lead) => lead.importId);

  await tx.query(sql`
    UPDATE lead
       SET owner_id = ${assignee.id},
           current_holder_id = ${assignee.id},
           routing_status = 'assigned',
           status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
           sales_pool_id = ${assignee.poolId},
           sales_team_id = ${assignee.teamId},
           stalled_at = NULL,
           stalled_reason = NULL
     WHERE organization_id = ${ctx.organizationId} AND id = ANY(${leadIds}::uuid[])`);

  // The lead's open callback follows it to the new owner.
  await tx.query(sql`
    UPDATE lead_callback SET owner_id = ${assignee.id}
     WHERE organization_id = ${ctx.organizationId} AND lead_id = ANY(${leadIds}::uuid[])
       AND status = 'pending' AND owner_id <> ${assignee.id}`);

  await tx.query(sql`
    INSERT INTO sales_routing_decision (organization_id, lead_id, mode, rules_version, candidate_snapshot, result, reason, actor_id)
    SELECT ${ctx.organizationId}, moved.lead_id,
           CASE WHEN moved.previous_owner IS NULL THEN 'direct' ELSE 'reassignment' END,
           NULL, 'null'::jsonb,
           jsonb_build_object('assigned', true, 'ownerId', ${assignee.id}::text, 'previousOwnerId', moved.previous_owner,
                              'importId', moved.import_id, 'via', ${via}::text),
           ${via === 'sheet' ? 'lead_import_sheet_assignment' : 'lead_import_assignment'},
           ${ctx.principal.id}
      FROM unnest(${leadIds}::uuid[], ${previous}::uuid[], ${importIds}::uuid[]) AS moved(lead_id, previous_owner, import_id)`);

  await tx.query(sql`
    INSERT INTO lead_activity (organization_id, lead_id, event_name, actor_id, metadata)
    SELECT ${ctx.organizationId}, moved.lead_id,
           CASE WHEN moved.previous_owner IS NULL THEN 'lead.assigned' ELSE 'lead.reassigned' END,
           ${ctx.principal.id},
           jsonb_build_object('ownerId', ${assignee.id}::text, 'previousOwnerId', moved.previous_owner,
                              'importId', moved.import_id, 'via', ${via}::text)
      FROM unnest(${leadIds}::uuid[], ${previous}::uuid[], ${importIds}::uuid[]) AS moved(lead_id, previous_owner, import_id)`);

  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    SELECT ${ctx.organizationId}, 'activity',
           jsonb_build_object(
             'action', CASE WHEN moved.previous_owner IS NULL THEN 'lead.assigned' ELSE 'lead.reassigned' END,
             'actorId', ${ctx.principal.id}::text, 'actorType', ${ctx.principal.accountType}::text,
             'targetType', 'lead', 'targetId', moved.lead_id,
             'before', jsonb_build_object('ownerId', moved.previous_owner),
             'after', jsonb_build_object('ownerId', ${assignee.id}::text, 'importId', moved.import_id, 'via', ${via}::text),
             'requestId', ${ctx.requestId}::text, 'sourceIp', ${ctx.sourceIp}::text)
      FROM unnest(${leadIds}::uuid[], ${previous}::uuid[], ${importIds}::uuid[]) AS moved(lead_id, previous_owner, import_id)`);

  await tx.query(sql`
    UPDATE lead_import_row
       SET assigned_to = ${assignee.id}, assigned_by = ${ctx.principal.id}, assigned_at = now(), assigned_via = ${via}
     WHERE organization_id = ${ctx.organizationId} AND id = ANY(${leads.map((lead) => lead.rowId)}::uuid[])`);
}
