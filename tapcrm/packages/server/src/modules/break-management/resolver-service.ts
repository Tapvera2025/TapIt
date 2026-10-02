import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import type { AttendanceBreakPolicyResolver, BreakPolicySnapshot } from '../attendance/facade.js';
import * as repo from './repository.js';
import { resolveBreakPolicy } from './resolver.js';

/**
 * Implements AttendanceBreakPolicyResolver using the break-management DB tables.
 * Registered into attendance's port slot at boot by initializePorts() (§13, MB-1).
 *
 * Extracts subject context from stored snapshots so recalculation can look up
 * the correct policy version without re-reading people or placement tables.
 */
export const breakPolicyResolverImpl: AttendanceBreakPolicyResolver = {
  async resolvePolicy(
    tx: Tx,
    organizationId: string,
    userId: string,
    workDate: DateOnly,
    storedPlacementSnapshot: unknown,
    storedShiftSnapshot: unknown,
  ): Promise<BreakPolicySnapshot | null> {
    // Extract subject context from stored snapshots.
    const placement = storedPlacementSnapshot as {
      departmentId?: string | null;
      positionId?: string | null;
      teamId?: string | null;
    } | null;
    const shift = storedShiftSnapshot as {
      shiftId?: string | null;
    } | null;

    const subject = {
      userId,
      departmentId: placement?.departmentId ?? null,
      positionId:   placement?.positionId   ?? null,
      teamId:       placement?.teamId        ?? null,
      shiftId:      shift?.shiftId           ?? null,
    };

    const assignments = await repo.loadAssignmentsForSubject(tx, organizationId, subject, workDate);
    const policyIds = [...new Set(assignments.map((a) => a.policyId))];
    const versions = await repo.loadVersionsForPolicies(tx, organizationId, policyIds, workDate);

    return resolveBreakPolicy(workDate, subject, assignments, versions);
  },
};
