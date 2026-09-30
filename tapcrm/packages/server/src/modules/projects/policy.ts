import { MATCH_NOTHING, registerResourcePolicy, type Resource, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Project resource policy. Same simplification as `client`'s (and `chat`'s):
 * the matrix grants a mix of 'own'/'dept'/'team' by position, but a project
 * has no department/team field distinct from who is actually assigned to it,
 * so every scope besides `all-people` collapses to "creator or assignee" —
 * matching `tasks:view`'s isCreator/isAssigned short-circuit, the precedent
 * this whole simplification follows.
 */
const projectPolicy: ResourcePolicy = {
  resourceType: 'project',
  domain: 'business',

  async check(ctx, _action, resource: Resource, scope): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return false; // PD-1: not allowed for business domain
    if (resource['createdBy'] === ctx.principal.id) return true;
    const assigneeIds = resource['assigneeIds'];
    return Array.isArray(assigneeIds) && assigneeIds.includes(ctx.principal.id);
  },

  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return MATCH_NOTHING;
    return {
      sql: `(p.created_by = $1 OR EXISTS (
        SELECT 1 FROM project_assignee pa WHERE pa.organization_id = p.organization_id AND pa.project_id = p.id AND pa.user_id = $1
      ))`,
      parameters: [ctx.principal.id],
    };
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
