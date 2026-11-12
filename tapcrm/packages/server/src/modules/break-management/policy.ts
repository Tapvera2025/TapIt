import { MATCH_ALL, MATCH_NOTHING, registerResourcePolicy, scopeMemberFilter, scopeReachesAny, type ResourcePolicy } from '@tapcrm/authz';

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
  // A breach is its employee's. HR holds all-people; a Team Lead's "team" or a
  // Supervisor's "pool" reaches their own people only — before, every scope
  // wider than `own` returned TRUE and showed every breach in the company.
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own' || scope === 'participant') return resource['userId'] === ctx.principal.id;
    return scopeReachesAny(ctx, scope, [resource['userId'] as string | null]);
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return MATCH_ALL;
    if (scope === 'own' || scope === 'participant') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    return scopeMemberFilter(ctx, scope, ['u.id']);
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerBreakPolicies(): void {
  registerResourcePolicy(breakPolicyResource);
  registerResourcePolicy(breakBreachResource);
}
