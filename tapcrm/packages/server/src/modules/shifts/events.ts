import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Outbox events from shifts (design §4, MB-3).
 *
 * A shift change must recalculate the days it touches (SH-6, "anchor changes",
 * "day facts rebuild"). Attendance owns recalculation and depends on shifts,
 * so shifts may not call it: it writes this event in the same transaction, and
 * attendance's handler (step 3) refreshes day facts and queues recalculation.
 * Until that handler exists the rows simply wait — the drainer claims only
 * events some process handles.
 */
export const SHIFT_EVENTS = {
  DAYS_CHANGED: 'shifts.days-changed',
} as const;

/** Exactly one of `userIds`, `departmentId` or `shiftId` says whose days changed. */
export interface DaysChanged {
  readonly userIds?: readonly string[];
  readonly departmentId?: string;
  readonly shiftId?: string;
  /** First changed date. Its neighbour before it changes too (§6.3). */
  readonly from: DateOnly;
  /** Last changed date, inclusive; null for open-ended. */
  readonly to: DateOnly | null;
  readonly reason: string;
}

export async function recordDaysChanged(
  tx: Tx,
  organizationId: string,
  change: DaysChanged,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${SHIFT_EVENTS.DAYS_CHANGED}, ${JSON.stringify(change)}::jsonb)
  `);
}
