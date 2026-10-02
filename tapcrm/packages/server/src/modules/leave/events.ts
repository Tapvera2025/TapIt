import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export const LEAVE_EVENTS = { DECIDED: 'leave.decided' } as const;

export interface LeaveDecided {
  readonly requestId: string;
  readonly userId: string;
  readonly leaveTypeId: string;
  readonly kind: 'absence' | 'attendance-mode';
  readonly fromDate: string;
  readonly toDate: string;
  readonly outcome: 'approved' | 'rejected' | 'revoked';
  readonly daysConsumed: number;
}

export async function recordLeaveDecided(
  tx: Tx,
  organizationId: string,
  event: LeaveDecided,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${LEAVE_EVENTS.DECIDED}, ${JSON.stringify(event)}::jsonb)
  `);
}
