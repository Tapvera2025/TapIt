import { MATCH_NOTHING, or, registerResourcePolicy, scopeMemberFilter, scopeMemberIds, scopeReachesAny, type Resource, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Client resource policy.
 *
 * A `client` has no department/team/pool field of its own, so reach goes
 * through its people: the creator and everyone assigned to a project for the
 * client. own/participant = the principal is one of them; pool/team/department
 * = any of them is inside that scope's people (scopeMemberIds). `all-people` is
 * people-domain only and never matches here (PD-1).
 */
const clientPolicy: ResourcePolicy = {
  resourceType: 'client',
  domain: 'business',

  async check(ctx, _action, resource: Resource, scope): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return false; // PD-1: not allowed for business domain
    const assigneeIds = Array.isArray(resource['projectAssigneeIds']) ? (resource['projectAssigneeIds'] as string[]) : [];
    const createdBy = resource['createdBy'];
    if (scope === 'own' || scope === 'participant') {
      return createdBy === ctx.principal.id || assigneeIds.includes(ctx.principal.id);
    }
    // pool / team / department: the creator or anyone assigned to a project
    // for this client is inside the scope's people.
    return scopeReachesAny(ctx, scope, [typeof createdBy === 'string' ? createdBy : null, ...assigneeIds]);
  },

  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return MATCH_NOTHING;
    const assigneeExists = (param: string) => `EXISTS (
        SELECT 1 FROM project p
        JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id
        WHERE p.organization_id = c.organization_id AND p.client_id = c.id AND pa.user_id ${param}
      )`;
    if (scope === 'own' || scope === 'participant') {
      return { sql: `(c.created_by = $1 OR ${assigneeExists('= $1')})`, parameters: [ctx.principal.id] };
    }
    const members = await scopeMemberIds(ctx, scope);
    if (members === null || members.size === 0) return MATCH_NOTHING;
    return or(
      await scopeMemberFilter(ctx, scope, ['c.created_by']),
      { sql: assigneeExists('= ANY($1::uuid[])'), parameters: [[...members]] },
    );
  },

  participantFields() {
    return ['createdBy', 'projectAssigneeIds'];
  },

  initiatorField() {
    return null;
  },
};

export function registerClientPolicies(): void {
  registerResourcePolicy(clientPolicy);
}
