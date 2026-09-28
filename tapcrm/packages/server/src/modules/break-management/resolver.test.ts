/**
 * Unit tests for resolver.ts — pure break-policy resolution.
 */
import { describe, it, expect } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import {
  resolveBreakPolicy,
  type CandidateAssignment,
  type CandidateVersion,
  type SubjectContext,
} from './resolver.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const d = (s: string) => s as DateOnly;

function version(
  overrides: Partial<CandidateVersion> & { versionId: string; policyId: string },
): CandidateVersion {
  return {
    effectiveFrom:         d('2026-01-01'),
    upperTotalMinutes:     60,
    upperSingleMinutes:    30,
    lowerTotalMinutes:     20,
    lowerEnforced:         false,
    graceMinutes:          5,
    warningPercent:        80,
    countsTowardWorkHours: false,
    ...overrides,
  };
}

function assignment(
  overrides: Partial<CandidateAssignment> & { assignmentId: string; policyId: string },
): CandidateAssignment {
  return {
    priority:     0,
    effectiveFrom: d('2026-01-01'),
    effectiveTo:  null,
    departmentId: null,
    positionId:   null,
    shiftId:      null,
    teamId:       null,
    userId:       null,
    ...overrides,
  };
}

const subject: SubjectContext = {
  userId:       'user-1',
  teamId:       'team-1',
  shiftId:      'shift-1',
  positionId:   'pos-1',
  departmentId: 'dept-1',
};

// ---------------------------------------------------------------------------
// Basic resolution
// ---------------------------------------------------------------------------

describe('resolveBreakPolicy', () => {
  it('returns null when no assignments exist', () => {
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [], [v])).toBeNull();
  });

  it('returns null when no versions exist for the policy', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1' }); // org-wide
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [])).toBeNull();
  });

  it('resolves the version for an org-wide assignment', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1' });
    const v = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 45 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [a], [v]);
    expect(result).not.toBeNull();
    expect(result!.policyVersionId).toBe('v1');
    expect(result!.upperTotalMinutes).toBe(45);
  });

  // ---------------------------------------------------------------------------
  // Date-range filtering
  // ---------------------------------------------------------------------------

  it('excludes assignment whose effectiveFrom is after workDate', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', effectiveFrom: d('2026-07-01') });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).toBeNull();
  });

  it('excludes assignment whose effectiveTo is on workDate (half-open range)', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', effectiveTo: d('2026-06-01') });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).toBeNull();
  });

  it('includes assignment whose effectiveTo is after workDate', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', effectiveTo: d('2026-06-02') });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [a], [v]);
    expect(result).not.toBeNull();
  });

  it('includes open-ended assignment (effectiveTo = null)', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', effectiveTo: null });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Subject matching
  // ---------------------------------------------------------------------------

  it('matches a user-targeted assignment for the correct user', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', userId: 'user-1' });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).not.toBeNull();
  });

  it('excludes a user-targeted assignment for a different user', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', userId: 'user-99' });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).toBeNull();
  });

  it('matches a team-targeted assignment for the correct team', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', teamId: 'team-1' });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).not.toBeNull();
  });

  it('excludes a team-targeted assignment when subject has no matching team', () => {
    const noTeam: SubjectContext = { ...subject, teamId: null };
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', teamId: 'team-1' });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), noTeam, [a], [v])).toBeNull();
  });

  it('matches a department-targeted assignment', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1', departmentId: 'dept-1' });
    const v = version({ versionId: 'v1', policyId: 'p1' });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Cascade rank
  // ---------------------------------------------------------------------------

  it('person-level assignment beats department-level assignment', () => {
    const aUser = assignment({ assignmentId: 'a1', policyId: 'p1', userId: 'user-1' });
    const aDept = assignment({ assignmentId: 'a2', policyId: 'p2', departmentId: 'dept-1' });
    const vUser = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 10 });
    const vDept = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 90 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [aDept, aUser], [vUser, vDept]);
    expect(result!.policyVersionId).toBe('v1');
    expect(result!.upperTotalMinutes).toBe(10);
  });

  it('team(2) beats shift(3)', () => {
    const aTeam  = assignment({ assignmentId: 'a1', policyId: 'p1', teamId: 'team-1' });
    const aShift = assignment({ assignmentId: 'a2', policyId: 'p2', shiftId: 'shift-1' });
    const vTeam  = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 11 });
    const vShift = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 99 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [aShift, aTeam], [vTeam, vShift]);
    expect(result!.policyVersionId).toBe('v1');
  });

  it('shift(3) beats position(4)', () => {
    const aShift = assignment({ assignmentId: 'a1', policyId: 'p1', shiftId: 'shift-1' });
    const aPos   = assignment({ assignmentId: 'a2', policyId: 'p2', positionId: 'pos-1' });
    const vShift = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 12 });
    const vPos   = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 99 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [aPos, aShift], [vShift, vPos]);
    expect(result!.policyVersionId).toBe('v1');
  });

  it('position(4) beats department(5)', () => {
    const aPos  = assignment({ assignmentId: 'a1', policyId: 'p1', positionId: 'pos-1' });
    const aDept = assignment({ assignmentId: 'a2', policyId: 'p2', departmentId: 'dept-1' });
    const vPos  = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 13 });
    const vDept = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 99 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [aDept, aPos], [vPos, vDept]);
    expect(result!.policyVersionId).toBe('v1');
  });

  it('department(5) beats org-wide(6)', () => {
    const aDept = assignment({ assignmentId: 'a1', policyId: 'p1', departmentId: 'dept-1' });
    const aOrg  = assignment({ assignmentId: 'a2', policyId: 'p2' }); // org-wide
    const vDept = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 14 });
    const vOrg  = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 99 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [aOrg, aDept], [vDept, vOrg]);
    expect(result!.policyVersionId).toBe('v1');
  });

  // ---------------------------------------------------------------------------
  // Priority tie-breaking within same rank
  // ---------------------------------------------------------------------------

  it('higher numeric priority wins within the same rank', () => {
    const a1 = assignment({ assignmentId: 'a1', policyId: 'p1', priority: 10 });
    const a2 = assignment({ assignmentId: 'a2', policyId: 'p2', priority: 20 });
    const v1 = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 10 });
    const v2 = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 20 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [a1, a2], [v1, v2]);
    expect(result!.policyVersionId).toBe('v2'); // higher priority wins
  });

  it('ascending UUID breaks priority ties', () => {
    const aA = assignment({ assignmentId: 'aaaa', policyId: 'p1', priority: 0 });
    const aB = assignment({ assignmentId: 'bbbb', policyId: 'p2', priority: 0 });
    const vA = version({ versionId: 'v1', policyId: 'p1', upperTotalMinutes: 10 });
    const vB = version({ versionId: 'v2', policyId: 'p2', upperTotalMinutes: 20 });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [aB, aA], [vA, vB]);
    expect(result!.policyVersionId).toBe('v1'); // 'aaaa' < 'bbbb'
  });

  // ---------------------------------------------------------------------------
  // Version resolution (latest version with effectiveFrom <= workDate)
  // ---------------------------------------------------------------------------

  it('picks the latest version whose effectiveFrom <= workDate', () => {
    const a  = assignment({ assignmentId: 'a1', policyId: 'p1' });
    const v1 = version({ versionId: 'v1', policyId: 'p1', effectiveFrom: d('2026-01-01'), upperTotalMinutes: 60 });
    const v2 = version({ versionId: 'v2', policyId: 'p1', effectiveFrom: d('2026-06-01'), upperTotalMinutes: 45 });
    const v3 = version({ versionId: 'v3', policyId: 'p1', effectiveFrom: d('2026-07-01'), upperTotalMinutes: 30 }); // future
    const result = resolveBreakPolicy(d('2026-06-15'), subject, [a], [v1, v2, v3]);
    expect(result!.policyVersionId).toBe('v2');
    expect(result!.upperTotalMinutes).toBe(45);
  });

  it('returns null when all versions are in the future', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1' });
    const v = version({ versionId: 'v1', policyId: 'p1', effectiveFrom: d('2027-01-01') });
    expect(resolveBreakPolicy(d('2026-06-01'), subject, [a], [v])).toBeNull();
  });

  it('maps all BreakPolicySnapshot fields correctly', () => {
    const a = assignment({ assignmentId: 'a1', policyId: 'p1' });
    const v = version({
      versionId:             'v1',
      policyId:              'p1',
      upperTotalMinutes:     90,
      upperSingleMinutes:    25,
      lowerTotalMinutes:     15,
      lowerEnforced:         true,
      graceMinutes:          3,
      warningPercent:        75,
      countsTowardWorkHours: true,
    });
    const result = resolveBreakPolicy(d('2026-06-01'), subject, [a], [v]);
    expect(result).toMatchObject({
      policyVersionId:       'v1',
      upperTotalMinutes:     90,
      upperSingleMinutes:    25,
      lowerTotalMinutes:     15,
      lowerEnforced:         true,
      graceMinutes:          3,
      warningPercent:        75,
      countsTowardWorkHours: true,
    });
  });
});
