/**
 * Break-management façade — the only file other modules may import (MB-1).
 * Callers: payroll (Step 9) for unresolvedBreaches; live-status for allowance.
 */
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';

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
 */
export async function unresolvedBreaches(
  _tx: Tx,
  _userIds: readonly string[],
  _from: DateOnly,
  _to: DateOnly,
): Promise<UnresolvedBreach[]> {
  // Implemented in Task 6.
  throw new Error('unresolvedBreaches not yet implemented');
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
