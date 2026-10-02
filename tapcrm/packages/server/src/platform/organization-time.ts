import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from './dal/db.js';
import { sql } from './dal/sql.js';
import { localDateOf, systemClock, type Clock } from './time.js';

/**
 * The organization's own calendar — NF-15, attendance design T-1.
 *
 * Both functions read the organization of the transaction they are given, so
 * they cannot be pointed at another tenant's timezone.
 */
export async function organizationTimezone(tx: Tx): Promise<string> {
  const row = await tx.one<{ timezone: string }>(sql`
    SELECT timezone FROM organization WHERE id = current_organization_id()
  `);
  return row.timezone;
}

/** Today's date for the transaction's organization, from an injectable clock (T-5). */
export async function organizationToday(tx: Tx, clock: Clock = systemClock): Promise<DateOnly> {
  return localDateOf(clock.now(), await organizationTimezone(tx));
}
