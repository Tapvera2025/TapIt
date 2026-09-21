import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../../../platform/dal/context.js';
import { buildOrganizationChart } from './service.js';
import type { ChartDepartmentRow, ChartRow } from './repository.js';

const employeeContext = (departmentId: string) =>
  ({
    organizationId: 'organization-1',
    requestId: 'request-1',
    sourceIp: null,
    memo: new Map(),
    principal: {
      id: 'sales-head',
      organizationId: 'organization-1',
      accountType: 'employee' as const,
      sessionVersion: 1,
      positionId: 'sales-head-position',
      departmentId,
      teamId: null,
      reportsTo: null,
      organizationalLevel: 90,
    },
  }) as RequestContext;

const superAdminContext = () =>
  ({
    organizationId: 'organization-1',
    requestId: 'request-1',
    sourceIp: null,
    memo: new Map(),
    principal: {
      id: 'root',
      organizationId: 'organization-1',
      accountType: 'super-admin' as const,
      sessionVersion: 1,
    },
  }) as RequestContext;

const departments: ChartDepartmentRow[] = [
  {
    id: 'sales',
    code: 'sales',
    name: 'Sales',
    status: 'active',
    headPositionNames: ['Sales Department Head'],
  },
  {
    id: 'development',
    code: 'development',
    name: 'Development',
    status: 'active',
    headPositionNames: ['Development Department Head'],
  },
];

const row = (
  id: string,
  departmentId: string,
  reportsTo: string | null,
  effectiveManagerId: string | null = null,
): ChartRow => ({
  id,
  fullName: id,
  positionId: `${id}-position`,
  departmentId,
  teamId: null,
  reportsTo,
  effectiveManagerId,
  effectiveManagerIds: effectiveManagerId === null ? [] : [effectiveManagerId],
  missingManager: false,
  managerVisible: reportsTo !== null,
});

describe('OR-13 / OR-14 organization chart visibility', () => {
  it('shows a department head their department people and other departments as structure only', () => {
    const chart = buildOrganizationChart(
      employeeContext('sales'),
      [row('sales-head', 'sales', null), row('sales-agent', 'sales', 'sales-head')],
      departments,
      'department',
      'department',
    );

    expect(chart.people.map((person) => person.id)).toEqual([
      'sales-head',
      'sales-agent',
    ]);
    expect(chart.departments).toEqual([
      expect.objectContaining({ id: 'sales', peopleVisible: true, structureOnly: false }),
      expect.objectContaining({
        id: 'development',
        peopleVisible: false,
        structureOnly: true,
      }),
    ]);
    expect(chart.people[0]?.childrenIds).toEqual(['sales-agent']);
  });

  it('does not infer people visibility from structure visibility for a project manager', () => {
    const chart = buildOrganizationChart(
      employeeContext('projects'),
      [],
      departments,
      'department',
      null,
    );
    expect(chart.people).toEqual([]);
    expect(chart.departments.every((department) => department.structureOnly)).toBe(true);
  });

  it('uses reportsTo rather than position hierarchy to form reporting edges', () => {
    const chart = buildOrganizationChart(
      employeeContext('sales'),
      [row('manager-a', 'sales', null), row('employee-b', 'sales', 'manager-a')],
      departments,
      'department',
      'department',
    );
    expect(chart.people.find((person) => person.id === 'manager-a')?.childrenIds).toEqual(
      ['employee-b'],
    );
  });

  it('uses a visible effective manager when reportsTo is null, and preserves disconnected missing managers', () => {
    const chart = buildOrganizationChart(
      employeeContext('sales'),
      [
        row('manager-a', 'sales', null),
        row('employee-b', 'sales', null, 'manager-a'),
        row('employee-c', 'sales', 'hidden-manager'),
      ],
      departments,
      'department',
      'department',
    );
    const effective = chart.people.find((person) => person.id === 'employee-b');
    const missing = chart.people.find((person) => person.id === 'employee-c');
    expect(effective?.managerVisible).toBe(true);
    expect(effective?.isRoot).toBe(false);
    expect(missing).toMatchObject({
      disconnected: true,
      isRoot: true,
      managerVisible: false,
    });
  });

  it('gives a super admin people visibility for every department', () => {
    const chart = buildOrganizationChart(
      superAdminContext(),
      [row('sales-agent', 'sales', null), row('developer', 'development', null)],
      departments,
      null,
      null,
    );
    expect(chart.departments.every((department) => department.peopleVisible)).toBe(true);
    expect(chart.people).toHaveLength(2);
  });
});
