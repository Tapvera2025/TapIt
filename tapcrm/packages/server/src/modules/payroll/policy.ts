import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';

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
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    return true;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerPayrollPolicies(): void {
  registerResourcePolicy(payrollRunResource);
  registerResourcePolicy(payrollConfigResource);
  registerResourcePolicy(payslipResource);
}
