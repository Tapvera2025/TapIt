import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, notify } from '../notifications/facade.js';
import { clip } from '../notifications/format.js';

/**
 * Project notifications. Follows the pattern in
 * team-docs/notification-engine-guide.md and modules/tasks/notifications.ts
 * (the reference implementation): one small file, called once from
 * service.ts inside the same transaction, so a rolled-back project creation
 * leaves no notification behind.
 */
const PROJECTS_LINK = '/company/projects';

/** New assignees only, never the actor. "You have been added to a new project — <name>". */
export async function notifyProjectAssigned(tx: Tx, ctx: RequestContext, project: { id: string; name: string }, userIds: readonly string[]): Promise<void> {
  const audience = [...new Set(userIds)].filter((id) => id !== ctx.principal.id);
  if (audience.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.PROJECT_ASSIGNED,
    priority: 'operational',
    audience: { users: audience },
    title: `You have been added to a new project — ${project.name}`,
    link: `${PROJECTS_LINK}/${project.id}`,
    metadata: { projectId: project.id },
  });
}

/** Notify the current project team when a client leaves feedback. */
export async function notifyClientFeedbackReceived(
  tx: Tx,
  ctx: RequestContext,
  project: { id: string; name: string },
  userIds: readonly string[],
  area: string,
  feedbackId: string,
  note: string,
): Promise<void> {
  const audience = [...new Set(userIds)].filter((id) => id !== ctx.principal.id);
  if (audience.length === 0) return;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.PROJECT_CLIENT_FEEDBACK,
    priority: 'operational',
    audience: { users: audience },
    title: `New client feedback — ${project.name}`,
    body: `Feedback on ${area}: ${clip(note, 240)}`,
    link: `${PROJECTS_LINK}/${project.id}`,
    metadata: { projectId: project.id, feedbackId, area },
  });
}
