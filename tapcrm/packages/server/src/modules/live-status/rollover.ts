import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { organizationToday } from '../../platform/organization-time.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as repo from './repository.js';
import { systemClock, type Clock } from '../../platform/time.js';

/**
 * Two-pass sweeper (§9.3, plan Task 5).
 *
 *   Pass A: BOOTSTRAP. Active users with an `attendance_record` for today
 *           but no `user_status` row. Handles the "new employee" and
 *           "step 4 just deployed" cases so the board never omits anyone.
 *   Pass B: ROLLOVER. Rows whose `rollover_due_at <= now`, refreshed so
 *           they move to the person's new day or advance to the next
 *           evaluation checkpoint (min(closing_cap, next_shift_start)).
 *
 * Both passes call `PresenceProjector.refresh` — LS-9 intact (the
 * projector is the sole writer of `user_status`). Small per-user
 * transactions so one slow refresh does not stall the batch.
 *
 * Returns the number of user_ids processed across both passes.
 */
export async function sweepRollovers(
  ctx: RequestContext,
  now: Date,
  limit = 500,
  clock: Clock = systemClock,
): Promise<number> {
  const projector = AttendanceFacade.presenceProjector();
  if (projector === null) return 0; // no projector registered → nothing to do

  // Pass A: bootstrap missing rows. Attendance lists active users with a
  // record for today (over its own tables); live-status subtracts the
  // users already in `user_status` (over its own table). Splitting keeps
  // each module reading only what it owns (SH-1 / MB-4).
  const today = await db.transaction(ctx, (tx) => organizationToday(tx, clock));
  const [withRecord, present] = await db.transaction(ctx, async (tx) => [
    await AttendanceFacade.listActiveUsersWithRecordFor(tx, today, limit),
    await repo.usersWithStatus(tx),
  ]);
  const missing = withRecord.filter((id) => !present.has(id));
  for (const userId of missing) {
    try {
      await db.transaction(ctx, (tx) => projector.refresh(tx, userId, now));
    } catch {
      // Best-effort per user; the next sweep tries again.
    }
  }

  // Pass B: due rollovers.
  const due = await db.transaction(ctx, (tx) => repo.rolloverBatch(tx, now, limit));
  for (const userId of due) {
    try {
      await db.transaction(ctx, (tx) => projector.refresh(tx, userId, now));
    } catch {
      // Same tolerance.
    }
  }

  return missing.length + due.length;
}
