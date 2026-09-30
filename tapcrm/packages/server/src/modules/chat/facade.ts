import type { Tx } from '../../platform/dal/db.js';
import { validateMemberIds, createGroupConversation as insertGroupConversation } from './repository.js';
import { ChatValidationError } from './errors.js';

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
 *     const conversation = await createProjectConversation(tx, ctx.organizationId, ctx.principal.id, {
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
 * other facade in this codebase.
 */
export async function createProjectConversation(
  tx: Tx,
  organizationId: string,
  createdBy: string,
  input: { name: string; memberIds: readonly string[]; projectId: string },
): Promise<{ id: string }> {
  const validIds = await validateMemberIds(tx, organizationId, input.memberIds);
  if (validIds.length !== input.memberIds.length) {
    const missing = input.memberIds.filter((id) => !validIds.includes(id));
    throw new ChatValidationError('One or more members do not exist or are not active in this organization', { missingUserIds: missing });
  }
  return insertGroupConversation(tx, organizationId, createdBy, { kind: 'project', name: input.name, memberIds: validIds, projectId: input.projectId });
}
