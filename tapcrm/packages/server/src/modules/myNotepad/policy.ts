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
 * Notepad resource policy.
 *
 * Implements object-level checks and list visibility filters across scopes:
 * - own: User's own notepad
 * - all-people: Super Admin / cross-people visibility
 *
 * Domain: 'people'
 */
export const notepadPolicy: ResourcePolicy = {
  resourceType: 'notepad',
  domain: 'people',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') {
      const ownerId = resource['ownerId'] ?? resource['userId'];
      return ownerId === ctx.principal.id;
    }
    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'user_id = $1', parameters: [ctx.principal.id] };
    return MATCH_NOTHING;
  },

  participantFields() {
    return [];
  },

  initiatorField() {
    return null;
  },
};

export function registerNotepadPolicies(): void {
  registerResourcePolicy(notepadPolicy);
}
