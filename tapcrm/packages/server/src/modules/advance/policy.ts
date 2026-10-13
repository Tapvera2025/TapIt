import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';

export const makeAdvanceResource = (
  id: string,
  organizationId: string,
  employeeId: string,
  requestedBy = employeeId,
) => ({
  type: 'employeeAdvance' as const,
  id,
  organizationId,
  subjectId: employeeId,
  userId: employeeId,
  requestedBy,
});

const policy: ResourcePolicy = {
  resourceType: 'employeeAdvance',
  domain: 'people',
  async check(ctx, action, resource) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (
      action === 'advance:approve' ||
      action === 'advance:manage' ||
      action === 'advance:export'
    )
      return true;
    return (
      resource['subjectId'] === ctx.principal.id ||
      resource['requestedBy'] === ctx.principal.id ||
      ctx.principal.accountType === 'super-admin'
    );
  },
  async filter(ctx, _action, scope) {
    if (scope === 'own')
      return { sql: 'employee_id = $1', parameters: [ctx.principal.id] };
    if (scope === 'participant')
      return {
        sql: 'employee_id = $1 OR created_by = $1 OR approved_by = $1 OR rejected_by = $1',
        parameters: [ctx.principal.id],
      };
    if (scope === 'department') {
      const id = await ctx.scope.departmentId(ctx);
      return id
        ? {
            sql: 'employee_id IN (SELECT id FROM app_user WHERE department_id = $1)',
            parameters: [id],
          }
        : MATCH_NOTHING;
    }
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => ['requestedBy', 'approvedBy', 'rejectedBy'],
  initiatorField: (action) => (action === 'advance:approve' ? 'requestedBy' : null),
};
export function registerAdvancePolicies(): void {
  registerResourcePolicy(policy);
}
