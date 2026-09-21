import { describe, expect, it } from 'vitest';
import { toSubtreeReassignmentPreview } from './service.js';
import type { ReportingUser } from './repository.js';

const user = (
  id: string,
  reportsTo: string | null,
  overrides: Partial<ReportingUser> = {},
): ReportingUser => ({
  id,
  organizationId: 'organization-1',
  isEmployee: true,
  isSuperAdmin: false,
  status: 'active',
  departmentId: 'department-1',
  teamId: 'team-1',
  positionId: id === 'manager-c' ? 'position-parent' : 'position-child',
  reportsTo,
  ...overrides,
});

describe('OR-10 manager reassignment preview projection', () => {
  it('moves the selected employee and every active descendant to the proposed manager', () => {
    const subject = user('employee-a', 'manager-b');
    const report = user('employee-a1', 'employee-a');
    const preview = toSubtreeReassignmentPreview(
      subject,
      user('manager-b', null),
      user('manager-c', null),
      [subject, report],
      'manager-c',
    );

    expect(preview.affectedUsers).toEqual([
      {
        userId: 'employee-a',
        currentManagerId: 'manager-b',
        proposedManagerId: 'manager-c',
        changed: true,
      },
      {
        userId: 'employee-a1',
        currentManagerId: 'employee-a',
        proposedManagerId: 'manager-c',
        changed: true,
      },
    ]);
    expect(preview.affectedCount).toBe(2);
    expect(preview.requiresConfirmation).toBe(true);
  });

  it('includes every deep descendant in the confirmed relationship set', () => {
    const subject = user('employee-a', 'manager-b');
    const direct = user('employee-a1', 'employee-a');
    const nested = user('employee-a2', 'employee-a1');
    const preview = toSubtreeReassignmentPreview(
      subject,
      user('manager-b', null),
      null,
      [subject, direct, nested],
      null,
    );

    expect(preview.affectedUsers.map((line) => line.userId)).toEqual([
      'employee-a',
      'employee-a1',
      'employee-a2',
    ]);
    expect(preview.affectedUsers.find((line) => line.changed)).toEqual({
      userId: 'employee-a',
      currentManagerId: 'manager-b',
      proposedManagerId: null,
      changed: true,
    });
    expect(
      preview.affectedUsers.reduce((count, line) => count + (line.changed ? 1 : 0), 0),
    ).toBe(3);
    expect(preview.affectedUsers.every((line) => line.proposedManagerId === null)).toBe(
      true,
    );
  });

  it('is a pure projection and does not mutate the reporting tree', () => {
    const subject = user('employee-a', 'manager-b');
    const report = user('employee-a1', 'employee-a');
    const before = JSON.stringify([subject, report]);
    toSubtreeReassignmentPreview(
      subject,
      user('manager-b', null),
      user('manager-c', null),
      [subject, report],
      'manager-c',
    );
    expect(JSON.stringify([subject, report])).toBe(before);
  });
});
