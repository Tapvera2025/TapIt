/**
 * Live-status presence snapshot read — SH-1 facade for external callers
 * (sales availability, bidding, routing). The sales module cannot JOIN
 * `user_status` directly; attendance design §6.2 says that table belongs
 * to this module and is read only through its façade.
 */

import type { PresenceState } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { OPERATIONAL_TZ } from '../../platform/time.js';

export interface PresenceSnapshot {
  readonly state: PresenceState | null;
  readonly dayGroup: 'leave' | 'holiday' | null;
  readonly shiftStartAt: Date | null;
  readonly shiftEndAt: Date | null;
}

/**
 * Today's presence snapshot for the requested users, keyed by userId.
 * Users without a `user_status` row for today are omitted from the map;
 * callers interpret that as "not punched in". Scoped to the request's
 * organization via RLS.
 */
export async function readPresenceToday(
  ctx: RequestContext,
  userIds: readonly string[],
): Promise<Map<string, PresenceSnapshot>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.query<{
    userId: string;
    state: PresenceState;
    dayGroup: 'leave' | 'holiday' | null;
    shiftStartAt: Date | null;
    shiftEndAt: Date | null;
  }>(
    ctx,
    sql`
      SELECT user_id         AS "userId",
             state           AS "state",
             day_group       AS "dayGroup",
             shift_start_at  AS "shiftStartAt",
             shift_end_at    AS "shiftEndAt"
        FROM user_status
       WHERE user_id = ANY(${userIds as unknown as string[]}::uuid[])
         AND work_date = (now() AT TIME ZONE ${OPERATIONAL_TZ})::date
    `,
  );
  return new Map(
    rows.map((r) => [
      r.userId,
      {
        state: r.state,
        dayGroup: r.dayGroup,
        shiftStartAt: r.shiftStartAt,
        shiftEndAt: r.shiftEndAt,
      },
    ]),
  );
}
