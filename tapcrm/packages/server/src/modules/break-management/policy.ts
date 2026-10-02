import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Resource policies for break-management (Task 4).
 *
 * breakPolicy — the policy template; managed by HR/admins with breaks:manage-policy.
 * breakBreach — a specific user's breach record; scoped to the user or HR reviewers.
 */

export const breakPolicyResource: ResourcePolicy = {
  resourceType: 'breakPolicy',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource['organizationId'] === ctx.organizationId;
  },
  async filter(_ctx, _action, scope) {
    // Break policies are org-level objects. Own/participant scope doesn't apply.
    if (scope === 'own' || scope === 'participant') return MATCH_NOTHING;
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export const breakBreachResource: ResourcePolicy = {
  resourceType: 'breakBreach',
  domain: 'people',
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    // all-people / department / team — for HR reviewers
    return true;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerBreakPolicies(): void {
  registerResourcePolicy(breakPolicyResource);
  registerResourcePolicy(breakBreachResource);
}
