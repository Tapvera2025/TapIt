import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * The employee directory's outbox events. Written in the transaction that
 * made the change, handled after commit by whoever depends on it — attendance
 * re-judges the person's days (§8.6) — so the directory never calls them.
 */
export const EMPLOYEE_EVENTS = {
  /** A joining or leaving date moved: the days `from..to` may now be judged differently. */
  EMPLOYMENT_CHANGED: 'employee.employment-changed',
} as const;

export interface EmploymentChanged {
  readonly userId: string;
  readonly from: DateOnly;
  /** Inclusive; null: every later day. */
  readonly to: DateOnly | null;
}

export async function recordEmploymentChanged(
  tx: Tx,
  organizationId: string,
  change: EmploymentChanged,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${EMPLOYEE_EVENTS.EMPLOYMENT_CHANGED}, ${JSON.stringify(change)}::jsonb)
  `);
}
