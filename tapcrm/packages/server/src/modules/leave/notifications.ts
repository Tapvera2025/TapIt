import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import {
  NOTIFICATION_TYPES,
  clip,
  dayCount,
  formatDay,
  formatDayRange,
  fullNames,
  notify,
} from '../notifications/facade.js';
import type { LeaveRequestRow } from './repository.js';

/**
 * Leave notifications — the Tasks pattern (modules/tasks/notifications.ts):
 * this file decides who hears about what; the service makes one call inside
 * its transaction, so a rolled-back request or decision notifies nobody.
 *
 *   event                         who                                   type             priority
 *   ────────────────────────────  ────────────────────────────────────  ───────────────  ─────────────
 *   leave or WFH requested        everyone who can decide it            leave.requested  operational
 *                                 (holders of leave:decide: HR, Super Admin)
 *   approved                      the employee                          leave.decided    informational
 *   declined                      the employee                          leave.decided    operational
 *   approved leave revoked        the employee                          leave.decided    operational
 *
 * The person who acted is never told about their own action, so HR is not
 * told about HR's own request (the Super Admin and other HR are). Cancelling
 * your own pending request tells nobody: it simply leaves the queue.
 */

const MY_LEAVE_LINK = '/company/leave/my';
const QUEUE_LINK = '/company/leave/queue';

type RequestRef = Pick<
  LeaveRequestRow,
  'id' | 'userId' | 'kind' | 'fromDate' | 'toDate' | 'daysConsumed' | 'recurrenceType' | 'recurrenceEnd'
>;

function period(request: RequestRef): string {
  if (request.recurrenceType === 'daily') {
    return `every working day, ${formatDay(request.fromDate)} to ${formatDay(request.recurrenceEnd ?? request.toDate)}`;
  }
  const range = formatDayRange(request.fromDate, request.toDate);
  return request.kind === 'absence' && request.daysConsumed > 0 ? `${range} (${dayCount(request.daysConsumed)})` : range;
}

/** A new request is waiting for a decision. */
export async function notifyLeaveRequested(
  tx: Tx,
  ctx: RequestContext,
  request: RequestRef,
  leaveTypeName: string,
): Promise<void> {
  const names = await fullNames(tx, ctx.organizationId, [request.userId]);
  const who = names.get(request.userId) ?? 'An employee';
  const what = request.kind === 'absence' ? leaveTypeName : `${leaveTypeName} (work from home)`;
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.LEAVE_REQUESTED,
    priority: 'operational',
    audience: { holders: { action: 'leave:decide' }, excludeUserIds: [request.userId] },
    title: clip(`${who} requested ${what}`, 200),
    body: clip(period(request), 500),
    link: QUEUE_LINK,
    metadata: { leaveRequestId: request.id },
  });
}

/** The employee hears the outcome of their request. */
export async function notifyLeaveDecided(
  tx: Tx,
  ctx: RequestContext,
  request: RequestRef,
  outcome: 'approved' | 'rejected' | 'revoked',
  leaveTypeName: string,
  note: string | null | undefined,
): Promise<void> {
  if (request.userId === ctx.principal.id) return;
  const title =
    outcome === 'approved'
      ? `Your ${leaveTypeName} was approved`
      : outcome === 'rejected'
        ? `Your ${leaveTypeName} request was declined`
        : `Your approved ${leaveTypeName} was revoked`;
  const detail = note && note.trim() !== '' ? ` — "${note.trim()}"` : '';
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.LEAVE_DECIDED,
    priority: outcome === 'approved' ? 'informational' : 'operational',
    audience: { users: [request.userId] },
    title: clip(title, 200),
    body: clip(`${period(request)}${detail}`, 500),
    link: MY_LEAVE_LINK,
    metadata: { leaveRequestId: request.id, outcome },
  });
}
