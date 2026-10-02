import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { NOTIFICATION_TYPES, clip, describePlacement, fullNames, notify } from '../notifications/facade.js';

/**
 * Position-change (role change) notifications — the Tasks pattern
 * (modules/tasks/notifications.ts): one call from the service, inside its
 * transaction.
 *
 *   event                      who                                          type                          priority
 *   ─────────────────────────  ───────────────────────────────────────────  ────────────────────────────  ─────────────
 *   HR requests a change       whoever can decide it (Super Admin)          access.role_change_requested  operational
 *   approved                   the HR requester; the employee (new place)   access.role_change_decided    informational
 *   declined                   the HR requester only                        access.role_change_decided    informational
 *
 * The employee is not told about a request that was declined: nothing about
 * them changed.
 */

const REVIEW_LINK = '/company/access/role-changes';
/** The request page is a form without history; the directory shows where the person now sits. */
const EMPLOYEES_LINK = '/company/employees';

async function positionNames(tx: Tx, organizationId: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await tx.query<{ id: string; name: string }>(sql`
    SELECT id, name FROM position
    WHERE organization_id = ${organizationId} AND id = ANY(${wanted}::uuid[])
  `);
  return new Map(rows.map((row) => [row.id, row.name]));
}

export interface RoleChangeRef {
  readonly id: string;
  readonly subjectUserId: string;
  readonly fromPositionId: string | null;
  readonly toPositionId: string;
  readonly requestedBy: string;
}

/** A request is waiting for the Super Admin. */
export async function notifyRoleChangeRequested(tx: Tx, ctx: RequestContext, request: RoleChangeRef): Promise<void> {
  const names = await fullNames(tx, ctx.organizationId, [request.subjectUserId, request.requestedBy]);
  const positions = await positionNames(tx, ctx.organizationId, [request.fromPositionId, request.toPositionId]);
  const subject = names.get(request.subjectUserId) ?? 'an employee';
  const before = request.fromPositionId ? (positions.get(request.fromPositionId) ?? 'current position') : 'no position';
  const after = positions.get(request.toPositionId) ?? 'a new position';
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.ROLE_CHANGE_REQUESTED,
    priority: 'operational',
    audience: { holders: { action: 'access:decide-role-change' }, excludeUserIds: [request.subjectUserId] },
    title: clip(`Position change requested for ${subject}`, 200),
    body: clip(`${before} → ${after}. Requested by ${names.get(request.requestedBy) ?? 'HR'}.`, 500),
    link: REVIEW_LINK,
    metadata: { roleChangeRequestId: request.id, userId: request.subjectUserId },
  });
}

/** The decision, to the HR requester and — when approved — to the employee. */
export async function notifyRoleChangeDecided(
  tx: Tx,
  ctx: RequestContext,
  request: RoleChangeRef,
  approved: boolean,
  reason: string,
): Promise<void> {
  const names = await fullNames(tx, ctx.organizationId, [request.subjectUserId]);
  const positions = await positionNames(tx, ctx.organizationId, [request.toPositionId]);
  const subject = names.get(request.subjectUserId) ?? 'an employee';
  const after = positions.get(request.toPositionId) ?? 'the new position';
  const outcome = approved ? 'approved' : 'declined';
  const note = reason.trim() !== '' ? ` Note: "${reason.trim()}"` : '';

  if (request.requestedBy !== ctx.principal.id) {
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.ROLE_CHANGE_DECIDED,
      audience: { users: [request.requestedBy] },
      title: clip(`Position change for ${subject} ${outcome}`, 200),
      body: clip(`${approved ? 'Moved to' : 'Not moved to'} ${after}.${note}`, 500),
      link: EMPLOYEES_LINK,
      metadata: { roleChangeRequestId: request.id, userId: request.subjectUserId, outcome },
    });
  }

  if (approved && request.subjectUserId !== ctx.principal.id) {
    const placement = await describePlacement(tx, ctx.organizationId, request.subjectUserId);
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.ROLE_CHANGE_DECIDED,
      audience: { users: [request.subjectUserId] },
      title: clip(`Your position is now ${after}`, 200),
      body: clip(placement ? `${placement}.` : `${after}.`, 500),
      link: null,
      metadata: { roleChangeRequestId: request.id, outcome },
    });
  }
}
