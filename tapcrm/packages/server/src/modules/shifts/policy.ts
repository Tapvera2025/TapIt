import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

/**
 * Shifts resource policies (AUTHORIZATION.md §6.4: `shift`, `shiftRequest`,
 * people domain).
 *
 * A template has no subject: anyone holding the action may see or manage it.
 * Anything about a person — an assignment, the explorer, a request — is judged
 * by the people scope rules `userPolicy` applies (modules/employee/policy.ts).
 */

async function coversPerson(
  ctx: PolicyEvaluationContext,
  resource: Resource,
  scope: Scope,
): Promise<boolean> {
  if (scope === 'all-people') return true;
  if (scope === 'department') {
    return (
      typeof resource['departmentId'] === 'string' &&
      resource['departmentId'] === (await ctx.scope.departmentId(ctx))
    );
  }
  const userId = resource['userId'];
  if (typeof userId !== 'string') return false; // a department default: department or all-people only
  if (scope === 'own') return userId === ctx.principal.id;
  const teamId = resource['teamId'];
  if (typeof teamId !== 'string') return false;
  if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(teamId);
  if (scope === 'pool') return (await ctx.scope.poolIds(ctx)).has(teamId);
  return false;
}

/** A list filter over people, alias `u` (app_user), matching `coversPerson`. */
async function peopleFilter(ctx: PolicyEvaluationContext, scope: Scope) {
  if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
  if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
  if (scope === 'department') {
    const departmentId = await ctx.scope.departmentId(ctx);
    return departmentId === null
      ? MATCH_NOTHING
      : { sql: 'u.department_id = $1', parameters: [departmentId] };
  }
  if (scope === 'team' || scope === 'pool') {
    const teams = [
      ...(scope === 'team' ? await ctx.scope.teamIds(ctx) : await ctx.scope.poolIds(ctx)),
    ];
    return teams.length === 0
      ? MATCH_NOTHING
      : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
  }
  return MATCH_NOTHING;
}

export const shiftPolicy: ResourcePolicy = {
  resourceType: 'shift',
  domain: 'people',
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    const aboutSomeone =
      typeof resource['userId'] === 'string' ||
      typeof resource['departmentId'] === 'string';
    return aboutSomeone ? coversPerson(ctx, resource, scope) : true;
  },
  filter: (ctx, _action, scope) => peopleFilter(ctx, scope),
  participantFields: () => [],
  initiatorField: () => null,
};

export const shiftRequestPolicy: ResourcePolicy = {
  resourceType: 'shiftRequest',
  domain: 'people',
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    return coversPerson(ctx, resource, scope);
  },
  filter: (ctx, _action, scope) => peopleFilter(ctx, scope),
  participantFields: () => ['requestedBy'],
  // A1 / SH-7 — nobody approves a request they raised.
  initiatorField: (action) => (action === 'shifts:approve' ? 'requestedBy' : null),
};

export function registerShiftPolicies(): void {
  registerResourcePolicy(shiftPolicy);
  registerResourcePolicy(shiftRequestPolicy);
}
