import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export function isTerminalLeadStatus(status: string): boolean {
  return status === 'converted' || status === 'closed_lost';
}

/**
 * The Handover module uses this lifecycle boundary for a receiver rejection.
 * Ownership is deliberately restored to the existing Lead owner; this is not
 * a reassignment operation.
 */
export async function closeLeadAsLostInTransaction(tx: Tx, organizationId: string, leadId: string, lossReason: string): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE lead
    SET status = 'closed_lost', loss_reason = ${lossReason}, lost_at = COALESCE(lost_at, now()), current_holder_id = owner_id
    WHERE organization_id = ${organizationId}
      AND id = ${leadId}
      AND status NOT IN ('converted', 'closed_lost')
    RETURNING id
  `);
  return rows.length > 0;
}
