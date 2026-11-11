/**
 * Who a lead can be given to, for the Reassign / Assign an owner dialog.
 *
 * Anyone active in Sales within the caller's reach can take a lead: a
 * Supervisor's pool, a Team Lead's team and its pools, a Sales Head's whole
 * department. Whether they are working right now is shown, not enforced —
 * leads are often handed out before a shift, or to cover someone on a break
 * or on leave (the same rule as handing out imported leads).
 */
import { effectivePolicy } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { scopeResolver } from '../../../platform/authz-adapter.js';
import { evaluateAvailability } from '../../../platform/availability/service.js';
import type { EligibilityReason } from '../../../platform/availability/types.js';

export const SALES_POSITION_CODES = ['sales-head', 'sales-team-lead', 'sales-supervisor', 'sales-agent'] as const;

export type AssigneeAvailability = 'working' | 'on_break' | 'not_punched_in' | 'on_leave' | 'on_holiday' | 'outside_shift' | 'unknown';

export interface LeadAssignee {
  readonly id: string;
  readonly fullName: string;
  readonly positionCode: string;
  readonly poolName: string | null;
  readonly availability: AssigneeAvailability;
  readonly atCapacity: boolean;
  readonly activeLeadCount: number;
  readonly isCurrentOwner: boolean;
}

export interface AssigneeHome {
  readonly id: string;
  readonly poolId: string | null;
  readonly teamId: string | null;
}

/** An active person in Sales, with the pool and Sales Team a lead of theirs belongs to. */
export async function loadSalesAssignee(tx: Tx, organizationId: string, userId: string): Promise<AssigneeHome | null> {
  return tx.maybeOne<AssigneeHome>(sql`
    SELECT u.id, u.team_id AS "poolId",
           CASE WHEN u.team_id IS NULL THEN NULL ELSE COALESCE(t.parent_team_id, u.team_id) END AS "teamId"
      FROM app_user u
      LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
      LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
      LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
     WHERE u.organization_id = ${organizationId} AND u.id = ${userId}
       AND u.account_type = 'employee' AND u.status = 'active'
       AND (d.code = 'sales' OR p.code = ANY(${[...SALES_POSITION_CODES]}::text[]))
  `);
}

function availabilityOf(reasons: readonly EligibilityReason[]): AssigneeAvailability {
  for (const reason of ['on_leave', 'on_holiday', 'on_break', 'not_punched_in', 'outside_shift'] as const) {
    if (reasons.includes(reason)) return reason;
  }
  return reasons.includes('service_unavailable') ? 'unknown' : 'working';
}

export async function listLeadAssignees(ctx: RequestContext, leadId: string): Promise<LeadAssignee[]> {
  const lead = await db.maybeOne<{ ownerId: string | null }>(ctx, sql`
    SELECT owner_id AS "ownerId" FROM lead WHERE organization_id = ${ctx.organizationId} AND id = ${leadId}
  `);
  if (!lead) return [];

  let reach = sql`TRUE`;
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'leads:reassign');
    const scope = policy?.allowed ? policy.scope : null;
    const authz = { ...ctx, scope: scopeResolver };
    if (scope === 'pool') reach = sql`u.team_id = ANY(${[...(await scopeResolver.poolIds(authz))]}::uuid[])`;
    else if (scope === 'team') reach = sql`u.team_id = ANY(${[...(await scopeResolver.teamIds(authz))]}::uuid[])`;
    else if (scope === 'department') reach = sql`u.department_id = ${await scopeResolver.departmentId(authz)}`;
    else reach = sql`u.id = ${ctx.principal.id}`;
  }

  const people = await db.query<{ id: string; fullName: string; positionCode: string; poolName: string | null }>(ctx, sql`
    SELECT u.id, u.full_name AS "fullName", p.code AS "positionCode", t.name AS "poolName"
      FROM app_user u
      JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
      LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
      LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
     WHERE u.organization_id = ${ctx.organizationId}
       AND u.account_type = 'employee' AND u.status = 'active'
       AND (d.code = 'sales' OR p.code = ANY(${[...SALES_POSITION_CODES]}::text[]))
       AND ${reach}
     ORDER BY u.full_name
  `);
  if (people.length === 0) return [];

  const availability = new Map((await evaluateAvailability(ctx, people.map((person) => person.id), { pool: 'direct' }))
    .map((result) => [result.userId, result]));
  const rank: Record<AssigneeAvailability, number> = {
    working: 0, on_break: 1, outside_shift: 2, not_punched_in: 3, unknown: 4, on_holiday: 5, on_leave: 6,
  };
  return people
    .map((person) => {
      const result = availability.get(person.id);
      return {
        ...person,
        availability: result ? availabilityOf(result.reasons) : 'unknown' as const,
        atCapacity: result?.reasons.includes('at_capacity') ?? false,
        activeLeadCount: result?.activeLeadCount ?? 0,
        isCurrentOwner: person.id === lead.ownerId,
      };
    })
    .sort((a, b) => rank[a.availability] - rank[b.availability] || a.activeLeadCount - b.activeLeadCount || a.fullName.localeCompare(b.fullName));
}
