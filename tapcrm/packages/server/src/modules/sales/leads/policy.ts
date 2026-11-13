import { MATCH_NOTHING, or, registerResourcePolicy, scopeMemberFilter, scopeReachesAny, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { LeadResource } from './types.js';

/**
 * Lead reach (PRD §3.5.1). A lead belongs to people (its owner and whoever
 * holds it right now) and is stamped with the pool and Sales Team it was
 * routed to. A scope reaches the lead through EITHER:
 *
 *   - the team columns — a Supervisor's pool, a Team Lead's team and its pools;
 *   - its people — the owner or current holder is inside the scope's people.
 *
 * Matching the team columns alone hid leads that were never stamped (created
 * by hand, imported, or owned by someone placed in a team later) and, because
 * `sales_team_id` holds the PARENT team, hid a pool's own leads from a pool
 * leader whose scope is "their team and teams below".
 */
export const leadPolicy: ResourcePolicy<LeadResource> = {
  resourceType: 'lead', domain: 'business',
  async check(ctx: PolicyEvaluationContext, _action: Action, resource: LeadResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    const people = [resource.ownerId, resource.currentHolderId];
    if (scope === 'own' || scope === 'participant') return people.includes(ctx.principal.id);
    if (await scopeReachesAny(ctx, scope, people)) return true;
    if (scope === 'pool') return resource.salesPoolId !== null && (await ctx.scope.poolIds(ctx)).has(resource.salesPoolId);
    if (scope === 'team') {
      const teams = await ctx.scope.teamIds(ctx);
      return (resource.salesTeamId !== null && teams.has(resource.salesTeamId)) || (resource.salesPoolId !== null && teams.has(resource.salesPoolId));
    }
    // A department manager (Sales Head) also sees leads waiting for an owner
    // that no team holds yet, so nothing unassigned is invisible to everyone.
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      if (departmentId === null) return false;
      return resource.departmentId === departmentId
        || (resource.departmentId === null && resource.salesTeamId === null && resource.ownerId === null);
    }
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') return { sql: '(l.owner_id = $1 OR l.current_holder_id = $1)', parameters: [ctx.principal.id] };
    const people = await scopeMemberFilter(ctx, scope, ['l.owner_id', 'l.current_holder_id']);
    if (scope === 'pool') {
      const ids = [...(await ctx.scope.poolIds(ctx))];
      return or(people, ids.length ? { sql: 'l.sales_pool_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING);
    }
    if (scope === 'team') {
      const ids = [...(await ctx.scope.teamIds(ctx))];
      return or(people, ids.length ? { sql: '(l.sales_team_id = ANY($1::uuid[]) OR l.sales_pool_id = ANY($1::uuid[]))', parameters: [ids] } : MATCH_NOTHING);
    }
    if (scope === 'department') {
      const id = await ctx.scope.departmentId(ctx);
      if (!id) return MATCH_NOTHING;
      return or(people, { sql: '(EXISTS (SELECT 1 FROM team scope_team WHERE scope_team.organization_id = l.organization_id AND scope_team.id = l.sales_team_id AND scope_team.department_id = $1) OR (l.sales_team_id IS NULL AND l.owner_id IS NULL))', parameters: [id] });
    }
    return MATCH_NOTHING;
  },
  participantFields: () => ['ownerId', 'currentHolderId'],
  initiatorField: () => null,
};
export function registerLeadPolicies(): void { registerResourcePolicy(leadPolicy); }
