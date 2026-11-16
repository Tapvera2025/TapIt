import { MATCH_NOTHING, or, registerResourcePolicy, scopeMemberFilter, scopeReachesAny, type PolicyEvaluationContext, type ResourcePolicy, type SqlFragment } from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { HandoverResource } from './types.js';

export function canViewInternalHandoverState(principalId: string, isGlobalPrincipal: boolean, ownerId: string | null, currentHolderId: string | null, hasAcceptedHandover = false): boolean {
  return isGlobalPrincipal || ownerId !== principalId || (!hasAcceptedHandover && currentHolderId === principalId);
}

/**
 * After a handover is accepted, the person who handed the lead over (its
 * owner) can still open it but no longer works it: the receiver holds it, and
 * keeps it until a manager reassigns it. True for that owner while someone
 * else holds the lead. A handover is the only thing that sets a holder other
 * than the owner; a reassignment moves both together.
 */
export function isHandedOverAway(lead: { ownerId: string | null; currentHolderId: string | null }, principalId: string): boolean {
  return lead.ownerId === principalId && lead.currentHolderId !== null && lead.currentHolderId !== principalId;
}

export const HANDED_OVER_MESSAGE = 'You handed this lead over, so the person who took it works it now. You can still see it, but you can’t change it until a manager gives it back to you.';

export const handoverPolicy: ResourcePolicy<HandoverResource> = {
  resourceType: 'handover', domain: 'business',
  async check(ctx: PolicyEvaluationContext, action: Action, resource: HandoverResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (action === 'handovers:view' && resource.status !== 'pending' && resource.fromUserId === ctx.principal.id) return false;
    if (action === 'handovers:receive') return resource.toUserId === ctx.principal.id || (resource.handoverMode === 'team_queue' && resource.status === 'pending' && resource.toUserId === null);
    if (action === 'handovers:record-disposition') return resource.toUserId === ctx.principal.id && resource.status === 'accepted' && resource.disposition === null;
    if (action === 'handovers:initiate') return resource.fromUserId === ctx.principal.id;
    if (scope === 'own' || scope === 'participant') return resource.fromUserId === ctx.principal.id || resource.toUserId === ctx.principal.id;
    // PRD §3.5.1: a handover is visible through EITHER chain — the giver's or the receiver's.
    if (await scopeReachesAny(ctx, scope, [resource.fromUserId, resource.toUserId])) return true;
    if (scope === 'pool') return resource.salesPoolId !== null && (await ctx.scope.poolIds(ctx)).has(resource.salesPoolId);
    if (scope === 'team') {
      const teams = await ctx.scope.teamIds(ctx);
      return (resource.salesTeamId !== null && teams.has(resource.salesTeamId)) || (resource.salesPoolId !== null && teams.has(resource.salesPoolId));
    }
    if (scope === 'department') return resource.departmentId !== null && resource.departmentId === await ctx.scope.departmentId(ctx);
    return false;
  },
  async filter(ctx: PolicyEvaluationContext, action: Action, scope: Scope): Promise<SqlFragment> {
    if (action === 'handovers:receive') return { sql: 'h.to_user_id = $1', parameters: [ctx.principal.id] };
    if (action === 'handovers:record-disposition') return { sql: 'h.to_user_id = $1 AND h.status = \'accepted\' AND h.disposition IS NULL', parameters: [ctx.principal.id] };
    if (action === 'handovers:initiate') return { sql: 'h.from_user_id = $1', parameters: [ctx.principal.id] };
    if (scope === 'own' || scope === 'participant') return { sql: '(h.from_user_id = $1 OR h.to_user_id = $1)', parameters: [ctx.principal.id] };
    const people = await scopeMemberFilter(ctx, scope, ['h.from_user_id', 'h.to_user_id']);
    if (scope === 'pool') { const ids = [...(await ctx.scope.poolIds(ctx))]; return or(people, ids.length ? { sql: 'l.sales_pool_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING); }
    if (scope === 'team') { const ids = [...(await ctx.scope.teamIds(ctx))]; return or(people, ids.length ? { sql: '(l.sales_team_id = ANY($1::uuid[]) OR l.sales_pool_id = ANY($1::uuid[]))', parameters: [ids] } : MATCH_NOTHING); }
    if (scope === 'department') { const id = await ctx.scope.departmentId(ctx); return id ? or(people, { sql: 'team.department_id = $1', parameters: [id] }) : MATCH_NOTHING; }
    return MATCH_NOTHING;
  },
  participantFields: () => ['fromUserId', 'toUserId'],
  initiatorField: () => 'fromUserId',
};

export function registerHandoverPolicies(): void { registerResourcePolicy(handoverPolicy); }
