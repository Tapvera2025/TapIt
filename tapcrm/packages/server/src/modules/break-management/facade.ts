/**
 * Break-management façade — the only file other modules may import (MB-1).
 * Callers: payroll (Step 9) for unresolvedBreaches; live-status for allowance.
 */
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { queryUnresolvedBreaches } from './repository.js';

export type UnresolvedBreachKind =
  | 'pending-consequence'      // status=pending, consequence in mark-late|mark-half-day|mark-absent|deduct-minutes|deduct-amount
  | 'pending-explanation';     // status pending|confirmed, consequence=require-explanation, explanation IS NULL

export interface UnresolvedBreach {
  readonly id: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly kind: UnresolvedBreachKind;
}

/**
 * Step 9 publish gate: returns current rows that block payroll publication.
 * (1) status='pending' AND consequence IN mark-late|mark-half-day|mark-absent|deduct-minutes|deduct-amount
 * (2) status IN ('pending','confirmed') AND consequence='require-explanation' AND explanation IS NULL
 *
 * The organization is read from the DB session context (RLS/app.organization_id).
 * Pass the running transaction so the check is atomic with the publication step.
 */
export async function unresolvedBreaches(
  tx: Tx,
  userIds: readonly string[],
  from: DateOnly,
  to: DateOnly,
): Promise<UnresolvedBreach[]> {
  if (userIds.length === 0) return [];
  // organizationId is read from the session-local setting via RLS; the query uses
  // current_organization_id() in the repository so we read it here too.
  const orgRow = await tx.one<{ v: string }>(
    { sql: `SELECT current_setting('app.organization_id') AS v`, parameters: [] },
  );
  const rows = await queryUnresolvedBreaches(tx, orgRow.v, userIds, from, to);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    workDate: r.workDate,
    kind: r.kind,
  }));
}

export {
  registerBreakDeductionWriter,
  breakDeductionWriter,
  type BreakDeductionWriter,
  type BreakDeductionInput,
} from './ports.js';

export {
  registerBreakPolicyResolver,
  breakPolicyResolver,
  type BreakPolicySnapshot,
  type AttendanceBreakPolicyResolver,
} from '../attendance/facade.js';
