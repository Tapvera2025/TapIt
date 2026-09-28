import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { CandidateAssignment, CandidateVersion, SubjectContext } from './resolver.js';

/**
 * DB loaders for the break policy resolver (§13 BM design, Task 3).
 *
 * No imports from attendance internals — only facade.js of sibling modules.
 * Callers pass all context via parameters so the queries are composable and
 * independently testable.
 */

/**
 * Load all break_policy_assignment rows for the organization that are active
 * or potentially active on workDate (including future-dated ones that break-management
 * needs to resolve). For evaluation, the caller passes workDate to resolveBreakPolicy.
 */
export async function loadAssignmentsForSubject(
  tx: Tx,
  organizationId: string,
  subject: SubjectContext,
  workDate: DateOnly,
): Promise<CandidateAssignment[]> {
  return tx.query<CandidateAssignment>(sql`
    SELECT id AS "assignmentId", policy_id AS "policyId", priority,
           effective_from::text AS "effectiveFrom",
           effective_to::text AS "effectiveTo",
           department_id AS "departmentId", position_id AS "positionId",
           shift_id AS "shiftId", team_id AS "teamId", user_id AS "userId"
    FROM break_policy_assignment
    WHERE organization_id = ${organizationId}
      AND effective_from <= ${workDate}
      AND (effective_to IS NULL OR effective_to > ${workDate})
      AND (
        user_id = ${subject.userId}::uuid
        OR (team_id IS NOT NULL AND team_id = ${subject.teamId ?? null}::uuid)
        OR (shift_id IS NOT NULL AND shift_id = ${subject.shiftId ?? null}::uuid)
        OR (position_id IS NOT NULL AND position_id = ${subject.positionId ?? null}::uuid)
        OR (department_id IS NOT NULL AND department_id = ${subject.departmentId ?? null}::uuid)
        OR (department_id IS NULL AND position_id IS NULL AND shift_id IS NULL AND team_id IS NULL AND user_id IS NULL)
      )
  `);
}

export async function loadVersionsForPolicies(
  tx: Tx,
  organizationId: string,
  policyIds: readonly string[],
  workDate: DateOnly,
): Promise<CandidateVersion[]> {
  if (policyIds.length === 0) return [];
  return tx.query<CandidateVersion>(sql`
    SELECT id AS "versionId", policy_id AS "policyId",
           effective_from::text AS "effectiveFrom",
           upper_total_minutes AS "upperTotalMinutes",
           upper_single_minutes AS "upperSingleMinutes",
           lower_total_minutes AS "lowerTotalMinutes",
           lower_enforced AS "lowerEnforced",
           grace_minutes AS "graceMinutes",
           warning_percent AS "warningPercent",
           counts_toward_work_hours AS "countsTowardWorkHours"
    FROM break_policy_version
    WHERE organization_id = ${organizationId}
      AND policy_id = ANY(${[...policyIds]}::uuid[])
      AND effective_from <= ${workDate}
    ORDER BY policy_id, effective_from DESC
  `);
}
