/**
 * Pure break-policy resolution (§13 BM design, Task 2).
 *
 * No DB calls. Takes data already loaded from the database and deterministically
 * picks the single winning policy version that governs a given work-date and
 * subject. This is the only place the cascade rank logic lives.
 *
 * Rank: person(1) → team(2) → shift(3) → position(4) → department(5) → org(6)
 * Within a rank: higher numeric `priority` wins; ascending UUID breaks ties.
 *
 * An assignment is active when:
 *   workDate >= effectiveFrom  AND  (effectiveTo IS NULL OR workDate < effectiveTo)
 *
 * The resolved version is the version of the winning assignment's policy whose
 * effectiveFrom is the largest date that is still <= workDate.
 *
 * Returns null when no assignment applies (= paid breaks, no limits, D19/Q2).
 */

import type { DateOnly } from '@tapcrm/contracts';
import type { BreakPolicySnapshot } from '../attendance/facade.js';

export interface CandidateAssignment {
  readonly assignmentId: string;
  readonly policyId: string;
  readonly priority: number;
  readonly effectiveFrom: DateOnly;
  readonly effectiveTo: DateOnly | null;   // null = open-ended
  readonly departmentId: string | null;
  readonly positionId:   string | null;
  readonly shiftId:      string | null;
  readonly teamId:       string | null;
  readonly userId:       string | null;
}

export interface CandidateVersion {
  readonly versionId: string;
  readonly policyId: string;
  readonly effectiveFrom: DateOnly;
  readonly upperTotalMinutes: number | null;
  readonly upperSingleMinutes: number | null;
  readonly lowerTotalMinutes: number | null;
  readonly lowerEnforced: boolean;
  readonly graceMinutes: number;
  readonly warningPercent: number;
  readonly countsTowardWorkHours: boolean;
}

export interface SubjectContext {
  readonly departmentId: string | null;
  readonly positionId:   string | null;
  readonly shiftId:      string | null;
  readonly teamId:       string | null;
  readonly userId:       string;
}

function assignmentRank(a: CandidateAssignment): number {
  if (a.userId !== null)       return 1;
  if (a.teamId !== null)       return 2;
  if (a.shiftId !== null)      return 3;
  if (a.positionId !== null)   return 4;
  if (a.departmentId !== null) return 5;
  return 6; // org-wide
}

function matchesSubject(a: CandidateAssignment, subject: SubjectContext): boolean {
  if (a.userId !== null)       return a.userId       === subject.userId;
  if (a.teamId !== null)       return a.teamId       === subject.teamId;
  if (a.shiftId !== null)      return a.shiftId      === subject.shiftId;
  if (a.positionId !== null)   return a.positionId   === subject.positionId;
  if (a.departmentId !== null) return a.departmentId === subject.departmentId;
  return true; // org-wide always matches
}

export function resolveBreakPolicy(
  workDate: DateOnly,
  subject: SubjectContext,
  assignments: readonly CandidateAssignment[],
  versions: readonly CandidateVersion[],
): BreakPolicySnapshot | null {
  // 1. Filter to assignments active on workDate that target this subject.
  const matching = assignments.filter((a) => {
    if (a.effectiveFrom > workDate) return false;
    if (a.effectiveTo !== null && a.effectiveTo <= workDate) return false;
    return matchesSubject(a, subject);
  });

  if (matching.length === 0) return null;

  // 2. Pick the winner: lowest rank → highest priority → ascending UUID.
  const winner = [...matching].sort((a, b) => {
    const ra = assignmentRank(a);
    const rb = assignmentRank(b);
    if (ra !== rb) return ra - rb;
    if (a.priority !== b.priority) return b.priority - a.priority; // higher first
    return a.assignmentId < b.assignmentId ? -1 : 1;              // ascending UUID
  })[0]!;

  // 3. Resolve the latest version for the winner's policy whose effectiveFrom <= workDate.
  const eligible = versions
    .filter((v) => v.policyId === winner.policyId && v.effectiveFrom <= workDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));

  if (eligible.length === 0) return null;
  const v = eligible[0]!;

  return {
    policyVersionId:      v.versionId,
    countsTowardWorkHours: v.countsTowardWorkHours,
    upperTotalMinutes:    v.upperTotalMinutes,
    upperSingleMinutes:   v.upperSingleMinutes,
    lowerTotalMinutes:    v.lowerTotalMinutes,
    lowerEnforced:        v.lowerEnforced,
    graceMinutes:         v.graceMinutes,
    warningPercent:       v.warningPercent,
  };
}
