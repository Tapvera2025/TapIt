import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, clip, describePlacement, notify } from '../notifications/facade.js';

/**
 * Employee notifications — the Tasks pattern (modules/tasks/notifications.ts).
 *
 *   event                                    who            type                         priority
 *   ───────────────────────────────────────  ─────────────  ───────────────────────────  ─────────────
 *   Super Admin changes someone's position,  the employee   employee.placement_changed   informational
 *   department, team or manager
 *
 * Profile edits (name, dates, codes) and account status changes notify nobody:
 * a deactivated account cannot read a notification anyway.
 */

export interface PlacementSnapshot {
  readonly departmentId: string | null;
  readonly positionId: string | null;
  readonly teamId: string | null;
  readonly reportsTo: string | null;
}

/** Only the difference is news: saving the same placement tells nobody. */
export async function notifyPlacementChanged(
  tx: Tx,
  ctx: RequestContext,
  userId: string,
  before: PlacementSnapshot,
  after: PlacementSnapshot,
): Promise<void> {
  if (userId === ctx.principal.id) return;
  const changed =
    before.departmentId !== after.departmentId ||
    before.positionId !== after.positionId ||
    before.teamId !== after.teamId ||
    before.reportsTo !== after.reportsTo;
  if (!changed) return;
  const placement = await describePlacement(tx, ctx.organizationId, userId);
  const title = before.positionId !== after.positionId || before.departmentId !== after.departmentId
    ? 'Your position was changed'
    : before.reportsTo !== after.reportsTo
      ? 'Your manager was changed'
      : 'Your team was changed';
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.PLACEMENT_CHANGED,
    audience: { users: [userId] },
    title,
    body: clip(placement ? `You are now ${placement}.` : 'Your placement in the organization was updated.', 500),
    link: null,
    metadata: { userId },
  });
}
