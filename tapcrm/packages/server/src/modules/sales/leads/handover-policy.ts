import { MATCH_NOTHING, registerResourcePolicy, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { HandoverResource } from './types.js';

export function canViewInternalHandoverState(principalId: string, isGlobalPrincipal: boolean, ownerId: string | null, currentHolderId: string | null, hasAcceptedHandover = false): boolean {
  return isGlobalPrincipal || ownerId !== principalId || (!hasAcceptedHandover && currentHolderId === principalId);
}

export const handoverPolicy: ResourcePolicy<HandoverResource> = {
  resourceType: 'handover', domain: 'business',
  async check(ctx: PolicyEvaluationContext, action: Action, resource: HandoverResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (action === 'handovers:view' && resource.status !== 'pending' && resource.fromUserId === ctx.principal.id) return false;
    if (action === 'handovers:receive') return resource.toUserId === ctx.principal.id;
    if (action === 'handovers:record-disposition') return resource.toUserId === ctx.principal.id && resource.status === 'accepted' && resource.disposition === null;
    if (action === 'handovers:initiate') return resource.fromUserId === ctx.principal.id;
    if (scope === 'own' || scope === 'participant') return resource.fromUserId === ctx.principal.id || resource.toUserId === ctx.principal.id;
    if (scope === 'pool') return resource.salesPoolId !== null && (await ctx.scope.poolIds(ctx)).has(resource.salesPoolId);
    if (scope === 'team') return resource.salesTeamId !== null && (await ctx.scope.teamIds(ctx)).has(resource.salesTeamId);
    if (scope === 'department') return resource.departmentId !== null && resource.departmentId === await ctx.scope.departmentId(ctx);
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, action: Action, scope: Scope): Promise<SqlFragment> {
    if (action === 'handovers:receive') return { sql: 'h.to_user_id = $1', parameters: [ctx.principal.id] };
    if (action === 'handovers:record-disposition') return { sql: 'h.to_user_id = $1 AND h.status = \'accepted\' AND h.disposition IS NULL', parameters: [ctx.principal.id] };
    if (action === 'handovers:initiate') return { sql: 'h.from_user_id = $1', parameters: [ctx.principal.id] };
    if (scope === 'own' || scope === 'participant') return { sql: '(h.from_user_id = $1 OR h.to_user_id = $1)', parameters: [ctx.principal.id] };
    if (scope === 'pool') { const ids = [...(await ctx.scope.poolIds(ctx))]; return ids.length ? { sql: 'l.sales_pool_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING; }
    if (scope === 'team') { const ids = [...(await ctx.scope.teamIds(ctx))]; return ids.length ? { sql: 'l.sales_team_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING; }
    if (scope === 'department') { const id = await ctx.scope.departmentId(ctx); return id ? { sql: 'team.department_id = $1', parameters: [id] } : MATCH_NOTHING; }
    return MATCH_NOTHING;
  },
  participantFields: () => ['fromUserId', 'toUserId'],
  initiatorField: () => 'fromUserId',
};

export function registerHandoverPolicies(): void { registerResourcePolicy(handoverPolicy); }
