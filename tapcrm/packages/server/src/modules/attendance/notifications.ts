import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, clip, formatDay, fullNames, notify } from '../notifications/facade.js';
import type { CorrectionRow } from './repository.js';

/**
 * Attendance correction notifications — the Tasks pattern
 * (modules/tasks/notifications.ts): one call from the service, inside its
 * transaction.
 *
 *   event                              who                                         type                              priority
 *   ─────────────────────────────────  ──────────────────────────────────────────  ────────────────────────────────  ─────────────
 *   employee asks to correct a day     everyone who can decide it                  attendance.correction_requested   operational
 *                                      (holders of attendance:correct: HR, Super Admin)
 *   HR raises one for someone          the deciders, and the employee (FYI)        attendance.correction_requested   operational / informational
 *   HR raises a batch                  the deciders, once for the whole batch      attendance.correction_requested   operational
 *   approved / declined                the employee; whoever raised it, if not    attendance.correction_decided     informational / operational
 *                                      the employee
 *
 * Nobody is told about their own action, and the employee and the requester
 * are never offered the decision (A1, G4), so they are left out of the
 * deciders' audience.
 */

const MY_ATTENDANCE_LINK = '/company/attendance/my';
const QUEUE_LINK = '/company/attendance/corrections';

const ASKS_TO: Record<CorrectionRow['kind'], string> = {
  'add-event': 'add a missing punch',
  'replace-event': 'change a punch time',
  'void-event': 'remove a punch',
  'confirm-as-is': 'confirm the day as recorded',
};

type CorrectionRef = Pick<CorrectionRow, 'id' | 'userId' | 'workDate' | 'kind' | 'requestedBy'>;

/** A new correction is waiting for a decision. */
export async function notifyCorrectionRequested(tx: Tx, ctx: RequestContext, correction: CorrectionRef): Promise<void> {
  const names = await fullNames(tx, ctx.organizationId, [correction.userId, correction.requestedBy]);
  const subject = names.get(correction.userId) ?? 'An employee';
  const requester = names.get(correction.requestedBy) ?? 'HR';
  const day = formatDay(correction.workDate);
  const selfRequest = correction.userId === correction.requestedBy;

  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CORRECTION_REQUESTED,
    priority: 'operational',
    audience: {
      holders: { action: 'attendance:correct' },
      excludeUserIds: [correction.userId, correction.requestedBy],
    },
    title: clip(selfRequest ? `${subject} asked to correct ${day}` : `Correction raised for ${subject} on ${day}`, 200),
    body: clip(
      selfRequest ? `Asks to ${ASKS_TO[correction.kind]}.` : `${requester} asks to ${ASKS_TO[correction.kind]}.`,
      500,
    ),
    link: QUEUE_LINK,
    metadata: { correctionId: correction.id, userId: correction.userId, workDate: correction.workDate },
  });

  if (!selfRequest && correction.userId !== ctx.principal.id) {
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.CORRECTION_REQUESTED,
      audience: { users: [correction.userId] },
      title: clip(`A correction to your attendance on ${day} was raised`, 200),
      body: clip(`${requester} asked to ${ASKS_TO[correction.kind]}. It takes effect once approved.`, 500),
      link: MY_ATTENDANCE_LINK,
      metadata: { correctionId: correction.id, workDate: correction.workDate },
    });
  }
}

/** A batch raised for many people: one message for the deciders, not one each. */
export async function notifyBulkCorrectionRaised(
  tx: Tx,
  ctx: RequestContext,
  batch: { readonly batchId: string; readonly workDate: string; readonly userIds: readonly string[] },
): Promise<void> {
  if (batch.userIds.length === 0) return;
  const names = await fullNames(tx, ctx.organizationId, [ctx.principal.id]);
  const requester = names.get(ctx.principal.id) ?? 'HR';
  const people = batch.userIds.length === 1 ? '1 person' : `${batch.userIds.length} people`;
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.CORRECTION_REQUESTED,
    priority: 'operational',
    audience: { holders: { action: 'attendance:correct' }, excludeUserIds: [...batch.userIds] },
    title: clip(`${people}: attendance corrections for ${formatDay(batch.workDate)}`, 200),
    body: clip(`${requester} asks to add a missing punch for ${people}.`, 500),
    link: QUEUE_LINK,
    metadata: { batchId: batch.batchId, workDate: batch.workDate, count: batch.userIds.length },
  });
}

/** The outcome, to the employee and to whoever raised it on their behalf. */
export async function notifyCorrectionDecided(
  tx: Tx,
  ctx: RequestContext,
  decided: Pick<CorrectionRow, 'id' | 'userId' | 'workDate' | 'requestedBy' | 'status' | 'decisionNote'>,
): Promise<void> {
  if (decided.status === 'pending') return;
  const approved = decided.status === 'approved';
  const day = formatDay(decided.workDate);
  const note = decided.decisionNote && decided.decisionNote.trim() !== '' ? ` Note: "${decided.decisionNote.trim()}"` : '';
  const outcome = approved ? 'approved' : 'declined';
  const effect = approved ? 'The day has been recalculated.' : 'The day stays as it was.';

  if (decided.userId !== ctx.principal.id) {
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.CORRECTION_DECIDED,
      priority: approved ? 'informational' : 'operational',
      audience: { users: [decided.userId] },
      title: clip(`Your attendance correction for ${day} was ${outcome}`, 200),
      body: clip(`${effect}${note}`, 500),
      link: MY_ATTENDANCE_LINK,
      metadata: { correctionId: decided.id, workDate: decided.workDate, outcome },
    });
  }

  if (decided.requestedBy !== decided.userId && decided.requestedBy !== ctx.principal.id) {
    const names = await fullNames(tx, ctx.organizationId, [decided.userId]);
    const subject = names.get(decided.userId) ?? 'an employee';
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.CORRECTION_DECIDED,
      audience: { users: [decided.requestedBy] },
      title: clip(`Correction for ${subject} on ${day} was ${outcome}`, 200),
      body: clip(`${effect}${note}`, 500),
      link: QUEUE_LINK,
      metadata: { correctionId: decided.id, workDate: decided.workDate, outcome },
    });
  }
}
