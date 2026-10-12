import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';
import type { ApprovalResource } from './types.js';

/**
 * ApprovalRequest resource policy (R2 plan step 2.11).
 *
 * Visibility ladder:
 *   own          — caller is the current approver or the requester
 *   participant  — same as own; approval requests have no third-party actors
 *   pool / team  — pool-level visibility rolls up to the requester's pool
 *   department   — department-level widens to the whole sales department
 */
export const approvalPolicy: ResourcePolicy<ApprovalResource> = {
  resourceType: 'approvalRequest',
  domain: 'business',

  async check(ctx: PolicyEvaluationContext, _action: Action, resource: ApprovalResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (scope === 'own' || scope === 'participant') {
      return resource.currentApproverId === ctx.principal.id
        || resource.requestedBy === ctx.principal.id;
    }
    if (scope === 'pool' || scope === 'team' || scope === 'department') {
      const members = await ctx.scope.poolMemberIds(ctx);
      return (resource.currentApproverId !== null && members.has(resource.currentApproverId))
        || members.has(resource.requestedBy);
    }
    return false;
  },

  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') {
      return {
        sql: '(approval_request.current_approver_id = $1 OR approval_request.requested_by = $1)',
        parameters: [ctx.principal.id],
      };
    }
    if (scope === 'pool' || scope === 'team' || scope === 'department') {
      const members = [...(await ctx.scope.poolMemberIds(ctx))];
      if (members.length === 0) return MATCH_NOTHING;
      return {
        sql: '(approval_request.current_approver_id = ANY($1::uuid[]) OR approval_request.requested_by = ANY($1::uuid[]))',
        parameters: [members],
      };
    }
    return MATCH_NOTHING;
  },

  participantFields: () => ['currentApproverId', 'requestedBy'],
  initiatorField: () => 'requestedBy',
};

export function registerApprovalPolicies(): void {
  registerResourcePolicy(approvalPolicy);
}
