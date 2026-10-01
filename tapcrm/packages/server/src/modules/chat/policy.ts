import { MATCH_NOTHING, registerResourcePolicy, type Resource, type ResourcePolicy } from '@tapcrm/authz';

/**
 * Chat resource policy — CH-1: "Chat is not scoped by hierarchy. Anyone may
 * message anyone." The one thing that actually gates access to a specific
 * conversation is MEMBERSHIP, not a position's granted scope: whatever scope
 * a position holds (the matrix currently grants 'department' to every
 * employee position, matching the existing pre-built row), the real check
 * below is uniform — you may read/write a conversation if and only if you are
 * a current member of it. This mirrors `tasks:view`'s isCreator/isAssigned
 * short-circuit: membership decides the object-level check regardless of the
 * scope parameter (§6.6 domain note explains why chat is one of the resources
 * whose real authorization is instance-shaped, not hierarchy-shaped).
 *
 * `all-people` never resolves to anything (PD-1 for business domain): nobody
 * gets an org-wide read of every conversation. Super Admin's access is
 * derived globalAccess (§4.7), unaffected by this policy.
 */
const chatConversationPolicy: ResourcePolicy = {
  resourceType: 'chatConversation',
  domain: 'business',

  async check(ctx, _action, resource: Resource): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    const memberIds = resource['memberIds'];
    return Array.isArray(memberIds) && memberIds.includes(ctx.principal.id);
  },

  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return MATCH_NOTHING;
    // Every other scope value collapses to the same fragment: there is no
    // "see my department's conversations" concept for this resource, only
    // "see conversations I am a member of."
    return {
      sql: `EXISTS (
        SELECT 1 FROM conversation_member cm
        WHERE cm.organization_id = c.organization_id AND cm.conversation_id = c.id
          AND cm.user_id = $1 AND cm.left_at IS NULL
      )`,
      parameters: [ctx.principal.id],
    };
  },

  participantFields() {
    return ['memberIds'];
  },

  initiatorField() {
    // No chat action is an approval or a self-decision (A1 does not apply).
    return null;
  },
};

export function registerChatPolicies(): void {
  registerResourcePolicy(chatConversationPolicy);
}
