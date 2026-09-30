import { MATCH_NOTHING, registerResourcePolicy, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { LeadResource } from './types.js';

export const leadPolicy: ResourcePolicy<LeadResource> = {
  resourceType: 'lead', domain: 'business',
  async check(ctx: PolicyEvaluationContext, _action: Action, resource: LeadResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') return resource.ownerId === ctx.principal.id || resource.currentHolderId === ctx.principal.id;
    if (scope === 'pool') return resource.salesPoolId !== null && (await ctx.scope.poolIds(ctx)).has(resource.salesPoolId);
    if (scope === 'team') return resource.salesTeamId !== null && (await ctx.scope.teamIds(ctx)).has(resource.salesTeamId);
    if (scope === 'department') return resource.departmentId !== null && resource.departmentId === await ctx.scope.departmentId(ctx);
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') return { sql: '(l.owner_id = $1 OR l.current_holder_id = $1)', parameters: [ctx.principal.id] };
    if (scope === 'pool') { const ids = [...(await ctx.scope.poolIds(ctx))]; return ids.length ? { sql: 'l.sales_pool_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING; }
    if (scope === 'team') { const ids = [...(await ctx.scope.teamIds(ctx))]; return ids.length ? { sql: 'l.sales_team_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING; }
    if (scope === 'department') { const id = await ctx.scope.departmentId(ctx); return id ? { sql: 'EXISTS (SELECT 1 FROM team scope_team WHERE scope_team.organization_id = l.organization_id AND scope_team.id = l.sales_team_id AND scope_team.department_id = $1)', parameters: [id] } : MATCH_NOTHING; }
    return MATCH_NOTHING;
  },
  participantFields: () => ['ownerId', 'currentHolderId'],
  initiatorField: () => null,
};
export function registerLeadPolicies(): void { registerResourcePolicy(leadPolicy); }
