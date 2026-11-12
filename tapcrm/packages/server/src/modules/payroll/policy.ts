import { MATCH_ALL, MATCH_NOTHING, registerResourcePolicy, scopeMemberFilter, scopeReachesAny, type ResourcePolicy } from '@tapcrm/authz';

const payrollRunResource: ResourcePolicy = {
  resourceType: 'payrollRun',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource['organizationId'] === ctx.organizationId;
  },
  async filter(_ctx, _action, scope) {
    if (scope === 'own' || scope === 'participant') return MATCH_NOTHING;
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => [],
  initiatorField: () => null,
};

const payrollConfigResource: ResourcePolicy = {
  resourceType: 'payrollConfig',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource['organizationId'] === ctx.organizationId;
  },
  async filter(_ctx, _action, scope) {
    if (scope === 'own' || scope === 'participant') return MATCH_NOTHING;
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => [],
  initiatorField: () => null,
};

const payslipResource: ResourcePolicy = {
  resourceType: 'payslip',
  domain: 'people',
  // A payslip is its employee's. Before, every scope wider than `own` returned
  // TRUE, so a manager granted "their team" read the whole company's pay.
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

export function registerPayrollPolicies(): void {
  registerResourcePolicy(payrollRunResource);
  registerResourcePolicy(payrollConfigResource);
  registerResourcePolicy(payslipResource);
}
