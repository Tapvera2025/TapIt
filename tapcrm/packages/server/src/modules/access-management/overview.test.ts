import { describe, expect, it } from 'vitest';
import { buildOverrideOverviewItem } from './service.js';
import type { OverrideOverviewRecord } from './repository.js';

function row(overrides: Partial<OverrideOverviewRecord> = {}): OverrideOverviewRecord {
  return {
    id: 'override-1',
    userId: 'user-1',
    fullName: 'Agent',
    email: 'agent@example.test',
    accountType: 'employee',
    organizationId: 'org-1',
    organizationCode: 'ORG001',
    organizationName: 'Example Org',
    positionId: 'position-1',
    positionName: 'Agent',
    departmentId: 'department-1',
    teamId: 'team-1',
    action: 'leads:view',
    allowed: true,
    scope: 'team',
    fields: null,
    reason: 'Temporary coverage',
    grantedBy: 'manager-1',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    ageDays: 265,
    reviewRequired: true,
    positionHolderCount: 10,
    matchingOverrideCount: 4,
    ...overrides,
  };
}

describe('access override overview', () => {
  it('flags overrides older than 180 days for review', () => {
    const item = buildOverrideOverviewItem(row());
    expect(item.reviewRequired).toBe(true);
    expect(item.ageDays).toBe(265);
  });

  it('recommends a position policy only above 30 percent, without changing the override', () => {
    const recommended = buildOverrideOverviewItem(row({ matchingOverrideCount: 4 }));
    const notRecommended = buildOverrideOverviewItem(row({ matchingOverrideCount: 3 }));
    expect(recommended.recommendPositionPolicy).toBe(true);
    expect(notRecommended.recommendPositionPolicy).toBe(false);
    expect(recommended.allowed).toBe(true);
    expect(recommended.scope).toBe('team');
  });
});
