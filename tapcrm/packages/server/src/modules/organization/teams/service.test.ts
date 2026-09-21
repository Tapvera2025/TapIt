import { describe, expect, it } from 'vitest';
import {
  assertTeamDepartmentChangeAllowed,
  assertTeamMemberDepartmentConsistency,
  isEligibleTeamLeadPosition,
} from './service.js';

describe('OR-9 team and department consistency', () => {
  it('allows an empty team to change departments when no child hierarchy is affected', () => {
    expect(() =>
      assertTeamDepartmentChangeAllowed({ activeMemberCount: 0, childTeamCount: 0 }),
    ).not.toThrow();
  });

  it('rejects changing the department of a team with active members', () => {
    expect(() =>
      assertTeamDepartmentChangeAllowed({ activeMemberCount: 2, childTeamCount: 0 }),
    ).toThrow(/active members/i);
  });

  it('rejects changing the department of a team with child teams', () => {
    expect(() =>
      assertTeamDepartmentChangeAllowed({ activeMemberCount: 0, childTeamCount: 1 }),
    ).toThrow(/child teams/i);
  });

  it('allows inactive-only membership to follow the existing lifecycle rule', () => {
    expect(() =>
      assertTeamDepartmentChangeAllowed({ activeMemberCount: 0, childTeamCount: 0 }),
    ).not.toThrow();
  });

  it('rejects assigning an employee to a team in another department', () => {
    expect(() =>
      assertTeamMemberDepartmentConsistency('department-a', 'department-b'),
    ).toThrow(/same department/i);
  });

  it('accepts a same-department team movement', () => {
    expect(() =>
      assertTeamMemberDepartmentConsistency('department-a', 'department-a'),
    ).not.toThrow();
  });

  it('accepts only canonical lead positions for each team kind', () => {
    expect(isEligibleTeamLeadPosition('sales-team', 'sales-team-lead')).toBe(true);
    expect(isEligibleTeamLeadPosition('sales-team', 'sales-supervisor')).toBe(true);
    expect(isEligibleTeamLeadPosition('sales-pool', 'sales-team-lead')).toBe(false);
    expect(isEligibleTeamLeadPosition('sales-pool', 'sales-supervisor')).toBe(true);
    expect(isEligibleTeamLeadPosition('dev-subteam', 'developer-team-manager')).toBe(
      true,
    );
    expect(isEligibleTeamLeadPosition('dev-subteam', 'developer')).toBe(false);
    expect(
      isEligibleTeamLeadPosition('dev-subteam', 'developer-team-manager', 'inactive'),
    ).toBe(false);
  });
});
