import { describe, expect, it } from 'vitest';
import type { OrganizationEmployee } from '../types/index.js';
import {
  buildReportingForest,
  filterReportingForest,
  matchesPerson,
  type ReportingNode,
} from './org-chart-model.js';

function person(
  id: string,
  reportsTo: string | null = null,
  extra: Partial<OrganizationEmployee> = {},
): OrganizationEmployee {
  return {
    id,
    fullName: id,
    reportsTo,
    departmentId: 'sales',
    positionId: null,
    teamId: null,
    ...extra,
  };
}
function ids(nodes: ReportingNode[]): string[] {
  return nodes.flatMap((node) => [node.person.id, ...ids(node.children)]);
}

describe('organization reporting tree', () => {
  it('uses explicit reporting lines and effective managers without duplicating people', () => {
    const forest = buildReportingForest([
      person('Member', null, { effectiveManagerId: 'Lead' }),
      person('Lead', 'Head', { effectiveManagerId: 'Someone else' }),
      person('Head'),
    ]);
    expect(forest.map((node) => node.person.id)).toEqual(['Head']);
    expect(forest[0]?.children[0]?.person.id).toBe('Lead');
    expect(forest[0]?.children[0]?.children[0]?.person.id).toBe('Member');
    expect(ids(forest)).toEqual(['Head', 'Lead', 'Member']);
  });

  it('retains missing and out-of-view managers as roots with their descendants', () => {
    const forest = buildReportingForest([
      person('Head', 'super-admin'),
      person('Member', 'Head'),
      person('Disconnected', 'hidden-manager'),
      person('Unassigned', null, { missingManager: true }),
    ]);
    expect(forest.map((node) => node.person.id)).toEqual([
      'Disconnected',
      'Head',
      'Unassigned',
    ]);
    expect(ids(forest)).toHaveLength(4);
  });

  it('breaks reporting cycles and self-references without losing employees', () => {
    const forest = buildReportingForest([
      person('A', 'B'),
      person('B', 'C'),
      person('C', 'A'),
      person('D', 'B'),
      person('Self', 'Self'),
    ]);
    expect(ids(forest).sort()).toEqual(['A', 'B', 'C', 'D', 'Self']);
    expect(
      forest.filter((node) => node.cycleBroken).map((node) => node.person.id),
    ).toEqual(['C', 'Self']);
  });

  it('keeps the full manager path to a search match and removes unrelated siblings', () => {
    const forest = buildReportingForest([
      person('Head'),
      person('Lead', 'Head'),
      person('Asha', 'Lead', { teamName: 'Growth' }),
      person('Other', 'Lead'),
    ]);
    expect(ids(filterReportingForest(forest, '  gRoWtH ', ''))).toEqual([
      'Head',
      'Lead',
      'Asha',
    ]);
    expect(ids(forest)).toContain('Other');
  });

  it('preserves cross-department ancestors when filtering by department', () => {
    const forest = buildReportingForest([
      person('Head'),
      person('Engineer', 'Head', { departmentId: 'engineering' }),
      person('Sales', 'Head'),
    ]);
    expect(ids(filterReportingForest(forest, '', 'engineering'))).toEqual([
      'Head',
      'Engineer',
    ]);
  });

  it('handles empty, unmatched, and unassigned records', () => {
    expect(buildReportingForest([])).toEqual([]);
    const forest = buildReportingForest([person('A', null, { departmentId: null })]);
    expect(filterReportingForest(forest, 'missing', '')).toEqual([]);
    expect(ids(filterReportingForest(forest, '', ''))).toEqual(['A']);
    expect(
      matchesPerson(
        person('A', null, { positionName: 'Sales Head' }),
        'head',
        'engineering',
      ),
    ).toBe(false);
  });
});
