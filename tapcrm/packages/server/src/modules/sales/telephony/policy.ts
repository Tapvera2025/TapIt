import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';

/**
 * Who may see a call: the employee the call is attributed to (through the
 * platform user → employee mapping), their team, their pool or their
 * department — the same reach Sales positions have on callbacks. A call whose
 * platform user is not mapped to an employee belongs to nobody yet, so only
 * Super Admin (global access) sees it until someone maps the user.
 *
 * List filters use the alias `emp` for the attributed employee (app_user).
 */
export type TelephonyCallResource = Resource & {
  readonly organizationId: string;
  readonly employeeId: string | null;
  readonly teamId: string | null;
  readonly departmentId: string | null;
};

export const telephonyCallPolicy: ResourcePolicy<TelephonyCallResource> = {
  resourceType: 'telephonyCall',
  domain: 'business',

  async check(ctx: PolicyEvaluationContext, _action: Action, resource: TelephonyCallResource, scope: Scope) {
    if (resource.organizationId !== ctx.organizationId) return false;
    if (resource.employeeId === null) return false;
    if (scope === 'own' || scope === 'participant') return resource.employeeId === ctx.principal.id;
    if (scope === 'team') return resource.teamId !== null && (await ctx.scope.teamIds(ctx)).has(resource.teamId);
    if (scope === 'pool') return resource.teamId !== null && (await ctx.scope.poolIds(ctx)).has(resource.teamId);
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return resource.departmentId !== null && departmentId !== null && resource.departmentId === departmentId;
    }
    return false;
  },

  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope): Promise<SqlFragment> {
    if (scope === 'own' || scope === 'participant') return { sql: 'emp.id = $1', parameters: [ctx.principal.id] };
    if (scope === 'team') {
      const ids = [...(await ctx.scope.teamIds(ctx))];
      return ids.length ? { sql: 'emp.team_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING;
    }
    if (scope === 'pool') {
      const ids = [...(await ctx.scope.poolIds(ctx))];
      return ids.length ? { sql: 'emp.team_id = ANY($1::uuid[])', parameters: [ids] } : MATCH_NOTHING;
    }
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId ? { sql: 'emp.department_id = $1', parameters: [departmentId] } : MATCH_NOTHING;
    }
    return MATCH_NOTHING;
  },

  participantFields: () => ['employeeId'],
  initiatorField: () => null,
};

export function registerTelephonyPolicies(): void {
  registerResourcePolicy(telephonyCallPolicy);
}
