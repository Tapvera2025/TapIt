import { MATCH_NOTHING, registerResourcePolicy, type Resource, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Client resource policy.
 *
 * The matrix (policy-matrix.ts) grants `clients:view`/`clients:manage` at a
 * mix of 'own', 'dept', 'team' and 'pool' scope depending on position — but a
 * `client` record has no department/team/pool field of its own (this phase's
 * schema is the simple form the business described: a name, a contact, a
 * region). Rather than inventing a derived department/team for a company-
 * level record, every scope besides `all-people`/`glob` collapses to the same
 * check here: the client's creator, or anyone currently assigned to a PROJECT
 * for that client, may see and manage it. This is the same simplification
 * `chat`'s policy makes (membership over the matrix's literal scope word) and
 * for the same reason — there is no coarser grouping that means anything for
 * this resource yet.
 */
const clientPolicy: ResourcePolicy = {
  resourceType: 'client',
  domain: 'business',

  async check(ctx, _action, resource: Resource, scope): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return false; // PD-1: not allowed for business domain
    if (resource['createdBy'] === ctx.principal.id) return true;
    const assigneeIds = resource['projectAssigneeIds'];
    return Array.isArray(assigneeIds) && assigneeIds.includes(ctx.principal.id);
  },

  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return MATCH_NOTHING;
    return {
      sql: `(c.created_by = $1 OR EXISTS (
        SELECT 1 FROM project p
        JOIN project_assignee pa ON pa.organization_id = p.organization_id AND pa.project_id = p.id
        WHERE p.organization_id = c.organization_id AND p.client_id = c.id AND pa.user_id = $1
      ))`,
      parameters: [ctx.principal.id],
    };
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
