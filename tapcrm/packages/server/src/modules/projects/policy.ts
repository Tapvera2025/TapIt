import { MATCH_NOTHING, or, registerResourcePolicy, scopeMemberFilter, scopeMemberIds, scopeReachesAny, type Resource, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Project resource policy. A project has no department/team field; reach goes
 * through its people (creator + assignees; there is no manager/owner column).
 * own/participant = the principal is creator or assignee; pool/team/department
 * = any of those people is inside the scope's people. `all-people` never
 * matches (business domain, PD-1).
 */
const projectPolicy: ResourcePolicy = {
  resourceType: 'project',
  domain: 'business',

  async check(ctx, _action, resource: Resource, scope): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return false; // PD-1: not allowed for business domain
    const assigneeIds = Array.isArray(resource['assigneeIds']) ? (resource['assigneeIds'] as string[]) : [];
    const createdBy = resource['createdBy'];
    if (scope === 'own' || scope === 'participant') {
      return createdBy === ctx.principal.id || assigneeIds.includes(ctx.principal.id);
    }
    return scopeReachesAny(ctx, scope, [typeof createdBy === 'string' ? createdBy : null, ...assigneeIds]);
  },

  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return MATCH_NOTHING;
    const assigneeExists = (param: string) =>
      `EXISTS (SELECT 1 FROM project_assignee pa WHERE pa.organization_id = p.organization_id AND pa.project_id = p.id AND pa.user_id ${param})`;
    if (scope === 'own' || scope === 'participant') {
      return { sql: `(p.created_by = $1 OR ${assigneeExists('= $1')})`, parameters: [ctx.principal.id] };
    }
    const members = await scopeMemberIds(ctx, scope);
    if (members === null || members.size === 0) return MATCH_NOTHING;
    return or(
      await scopeMemberFilter(ctx, scope, ['p.created_by']),
      { sql: assigneeExists('= ANY($1::uuid[])'), parameters: [[...members]] },
    );
  },

  participantFields() {
    return ['createdBy', 'assigneeIds'];
  },

  initiatorField() {
    return null;
  },
};

export function registerProjectPolicies(): void {
  registerResourcePolicy(projectPolicy);
}
