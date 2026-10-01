import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import {
  addConversationMembers,
  renameConversation,
  validateMemberIds,
  createGroupConversation as insertGroupConversation,
} from './repository.js';
import { ChatValidationError } from './errors.js';
import { notifyGroupMembersAdded } from './notifications.js';

/**
 * ChatFacade — the surface other modules call (MB-1). Not exercised by any
 * caller yet: this is the extension point Phase 4 (Projects) uses for the
 * two-step flow — "1. project created, 2. create its discussion group with a
 * suggested name and the assigned team pre-selected." Call it inside the
 * SAME transaction as the business change that creates the group, exactly
 * like `notify()` (TX-2): a rolled-back project creation must not leave a
 * conversation behind.
 *
 *   await db.transaction(ctx, async (tx) => {
 *     const project = await createProject(tx, input);
 *     const conversation = await createProjectConversation(tx, ctx, {
 *       name: `${project.name} – ${client.businessName}`,
 *       memberIds: [...assignedEmployeeIds, clientUserId],
 *       projectId: project.id,
 *     });
 *   });
 *
 * Membership is validated here (active, non-service accounts of this
 * organization) so a caller cannot silently create a group with a stale or
 * cross-tenant id; it does NOT check that the caller is allowed to add each
 * person — that authorization belongs to the CALLING module's own action
 * (e.g. `projects:manage`), the same division of responsibility as every
 * other facade in this codebase. Newly added members are notified
 * ("You were added to ...") the same as any other group, via the SAME
 * transaction.
 */
export async function createProjectConversation(
  tx: Tx,
  ctx: Pick<RequestContext, 'organizationId' | 'principal'>,
  input: { name: string; memberIds: readonly string[]; projectId: string },
): Promise<{ id: string }> {
  const validIds = await validateMemberIds(tx, ctx.organizationId, input.memberIds);
  if (validIds.length !== input.memberIds.length) {
    const missing = input.memberIds.filter((id) => !validIds.includes(id));
    throw new ChatValidationError('One or more members do not exist or are not active in this organization', { missingUserIds: missing });
  }
  const created = await insertGroupConversation(tx, ctx.organizationId, ctx.principal.id, {
    kind: 'project',
    name: input.name,
    memberIds: validIds,
    projectId: input.projectId,
  });
  await notifyGroupMembersAdded(tx, ctx, { id: created.id, name: input.name }, validIds);
  return created;
}

/**
 * Renaming/describing a project's discussion group is NOT `chat:manage-groups`
 * (Super-Admin-only, and that service layer explicitly refuses 'project'
 * conversations — see chat/service.ts's `requireGroup`). It is authorized by
 * the PROJECTS module's own `projects:manage` on that specific project, so
 * the caller has already checked that by the time this runs.
 */
export async function renameProjectConversation(
  tx: Tx,
  organizationId: string,
  conversationId: string,
  name: string,
  description: string | null | undefined,
): Promise<void> {
  await renameConversation(tx, organizationId, conversationId, name, description);
}

/**
 * Adds newly assigned project team members to the discussion group; never
 * removes anyone (the client, and anyone added by hand, stay put even if
 * they later drop off the project's assignee list — removal is an explicit,
 * separate action, not a side effect of a team edit).
 */
export async function addProjectConversationMembers(
  tx: Tx,
  ctx: Pick<RequestContext, 'organizationId' | 'principal'>,
  conversationId: string,
  memberIds: readonly string[],
  groupName: string,
): Promise<void> {
  if (memberIds.length === 0) return;
  const validIds = await validateMemberIds(tx, ctx.organizationId, memberIds);
  if (validIds.length === 0) return;
  await addConversationMembers(tx, ctx.organizationId, conversationId, validIds);
  await notifyGroupMembersAdded(tx, ctx, { id: conversationId, name: groupName }, validIds);
}
