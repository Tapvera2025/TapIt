import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * `holidays.days-changed` — the mirror of `shifts.days-changed` (design §4).
 *
 * Attendance depends on holidays, so holidays cannot call attendance directly.
 * Every create, withdraw or scope change writes this event; step 3's handler
 * refreshes day facts and queues recalculation. Until that handler exists,
 * the rows wait.
 *
 * Range convention: `from` is inclusive, `toExclusive` is exclusive, matching
 * the underlying `holiday.effective_from`/`effective_to`. This deliberately
 * differs from step 1's `shifts.days-changed`, which converts to an inclusive
 * `to` before writing. A future unification would rename step 1's field to
 * match this one; for now attendance's step-3 handler knows the difference.
 *
 * Blast-radius rules (both axes are computed the same way):
 *
 *   create        → new scope
 *   withdraw      → old scope
 *   scope change  → UNION(old scope, new scope)
 *
 * "Scope" here means the id sets, not the shape. Two corollaries:
 *
 *   1. Any transition involving national — e.g. `national → department`,
 *      `department → national`, or `national → shift` — has to recalculate
 *      the whole organization on at least one side. The event expresses that
 *      by omitting BOTH `departmentIds` and `shiftIds` (an empty/undefined
 *      set means "the whole organization," matching the create-side of a
 *      national holiday).
 *   2. A department → shift (or shift → department) axis change legitimately
 *      produces an event with BOTH `departmentIds` (the old side) and
 *      `shiftIds` (the new side). The holiday itself still can't carry mixed
 *      scopes; the event blast radius can.
 *
 * The handler unions its own person-day expansion across the two axes.
 */
export const HOLIDAY_EVENTS = { DAYS_CHANGED: 'holidays.days-changed' } as const;

export interface DaysChanged {
  /**
   * The departments whose people must be recalculated. Empty/undefined AND
   * `shiftIds` empty/undefined together mean "the whole organization" — used
   * when either side of a scope change was national.
   */
  readonly departmentIds?: readonly string[];
  readonly shiftIds?: readonly string[];
  /** First changed date, inclusive. */
  readonly from: DateOnly;
  /**
   * One past the last changed date. `null` for an open-ended week-off rule.
   * For a single dated holiday, `toExclusive = addDays(from, 1)`.
   */
  readonly toExclusive: DateOnly | null;
  readonly reason: string;
}

export async function recordDaysChanged(
  tx: Tx,
  organizationId: string,
  change: DaysChanged,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${HOLIDAY_EVENTS.DAYS_CHANGED}, ${JSON.stringify(change)}::jsonb)
  `);
}
