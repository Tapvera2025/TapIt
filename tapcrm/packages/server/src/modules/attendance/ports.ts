import type { PresenceProjector, DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';

/**
 * The presence projector port (design §4, D9, LS-1). live-status implements it
 * and registers it at boot (step 4); attendance calls it inside `appendEvent`,
 * in the same transaction, and so never imports live-status. Until step 4 there
 * is nothing to project, so no projector is registered and the call is skipped.
 */
let projector: PresenceProjector<Tx> | null = null;

export function registerPresenceProjector(next: PresenceProjector<Tx>): void {
  if (projector !== null) throw new Error('A presence projector is already registered');
  projector = next;
}

export function presenceProjector(): PresenceProjector<Tx> | null {
  return projector;
}

/** Tests only. */
export function __resetPresenceProjector(): void {
  projector = null;
}

/**
 * Break policy resolver port (§13, BM design).
 * Registered by break-management at boot, called by attendance during recalculation.
 * Returns null when no policy applies (= paid breaks, no limits).
 */
export interface BreakPolicySnapshot {
  readonly policyVersionId: string;
  readonly countsTowardWorkHours: boolean;
  readonly upperTotalMinutes: number | null;
  readonly upperSingleMinutes: number | null;
  readonly lowerTotalMinutes: number | null;
  readonly lowerEnforced: boolean;
  readonly graceMinutes: number;
  readonly warningPercent: number;
}

export interface AttendanceBreakPolicyResolver {
  resolvePolicy(
    tx: Tx,
    organizationId: string,
    userId: string,
    workDate: DateOnly,
    storedPlacementSnapshot: unknown,
    storedShiftSnapshot: unknown,
  ): Promise<BreakPolicySnapshot | null>;
}

let breakResolver: AttendanceBreakPolicyResolver | null = null;

export function registerBreakPolicyResolver(r: AttendanceBreakPolicyResolver): void {
  if (breakResolver !== null) throw new Error('A BreakPolicyResolver is already registered');
  breakResolver = r;
}

export function breakPolicyResolver(): AttendanceBreakPolicyResolver | null {
  return breakResolver;
}

/** Tests only. */
export function __resetBreakPolicyResolver(): void {
  breakResolver = null;
}
