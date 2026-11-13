import { MATCH_NOTHING, or, registerResourcePolicy, scopeMemberFilter, scopeReachesAny, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { MeetingResource, MeetingStatus } from './types.js';

/**
 * A meeting belongs to its host. `own` is the host's own meetings; a pool,
 * team or department reaches the meetings hosted by the people in it, so a
 * Supervisor, Team Lead or department head can answer, move, watch or join
 * their people's meetings according to which action the scope is on.
 * List queries alias the table `m`.
 */
export const meetingPolicy: ResourcePolicy<MeetingResource> = {
  resourceType: 'meeting',
  domain: 'business',
  async check(ctx: PolicyEvaluationContext, _action: Action, resource: MeetingResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') return resource.hostId === ctx.principal.id;
    if (scope === 'pool') return (await ctx.scope.poolMemberIds(ctx)).has(resource.hostId);
    if (scope === 'team' || scope === 'department') {
      // People route first: the host sits in the team tree / reporting line / department.
      if (await scopeReachesAny(ctx, scope, [resource.hostId])) return true;
    }
    if (scope === 'team') return resource.hostTeamId !== null && (await ctx.scope.teamIds(ctx)).has(resource.hostTeamId);
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId !== null && resource.hostDepartmentId === departmentId;
    }
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') return { sql: 'm.host_id = $1', parameters: [ctx.principal.id] };
    if (scope === 'pool') {
      const ids = [...(await ctx.scope.poolMemberIds(ctx))];
      return ids.length ? { sql: 'm.host_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING;
    }
    if (scope === 'team') {
      const ids = [...(await ctx.scope.teamIds(ctx))];
      return or(
        await scopeMemberFilter(ctx, scope, ['m.host_id']),
        ids.length
          ? { sql: 'm.host_id IN (SELECT scope_user.id FROM app_user scope_user WHERE scope_user.organization_id = m.organization_id AND scope_user.team_id = ANY($1::uuid[]))', parameters: [ids] }
          : MATCH_NOTHING,
      );
    }
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return or(
        await scopeMemberFilter(ctx, scope, ['m.host_id']),
        departmentId
          ? { sql: 'm.host_id IN (SELECT scope_user.id FROM app_user scope_user WHERE scope_user.organization_id = m.organization_id AND scope_user.department_id = $1)', parameters: [departmentId] }
          : MATCH_NOTHING,
      );
    }
    return MATCH_NOTHING;
  },
  participantFields: () => ['hostId'],
  initiatorField: () => null,
};

export function registerMeetingPolicies(): void {
  registerResourcePolicy(meetingPolicy);
}

export async function loadMeetingResource(ctx: RequestContext, id: string): Promise<MeetingResource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string; hostId: string; hostTeamId: string | null; hostDepartmentId: string | null; status: MeetingStatus }>(ctx, sql`
    SELECT m.id, m.organization_id AS "organizationId", m.host_id AS "hostId",
           host.team_id AS "hostTeamId", host.department_id AS "hostDepartmentId", m.status
      FROM meeting m
      JOIN app_user host ON host.organization_id = m.organization_id AND host.id = m.host_id
     WHERE m.organization_id = ${ctx.organizationId} AND m.id = ${id}
  `);
  return row ? { type: 'meeting', ...row } : null;
}
