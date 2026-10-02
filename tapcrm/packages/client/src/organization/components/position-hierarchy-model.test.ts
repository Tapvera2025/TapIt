import { describe, expect, it } from 'vitest';
import type { OrganizationPosition } from '../types/index.js';
import {
  availableParents,
  canAddAbove,
  canMoveUnder,
  filterPositionTree,
  flattenPositions,
  initialCollapsedPositions,
  positionPath,
} from './position-hierarchy-model.js';

function position(
  id: string,
  parentPositionId: string | null,
  children: OrganizationPosition[] = [],
  status = 'active',
): OrganizationPosition {
  return {
    id,
    name: id,
    code: `DEV-${id.toUpperCase()}`,
    organizationId: 'org',
    departmentId: 'dev',
    parentPositionId,
    children,
    organizationalLevel: 50,
    status,
    holderCount: 0,
    isSeeded: false,
    maxDealValue: null,
    maxDiscountPercent: null,
    allowsCustomTerms: false,
  };
}
const developer = position('Developer', 'Lead');
const intern = position('Intern', 'Developer');
developer.children = [intern];
const lead = position('Lead', 'Head', [developer]);
const analyst = position('Analyst', 'Head', [], 'inactive');
const head = position('Head', null, [lead, analyst]);
const forest = [head];

describe('position hierarchy explorer', () => {
  it('keeps the full parent path to a name or code match', () => {
    const filtered = filterPositionTree(forest, 'dev-developer', '');
    expect(flattenPositions(filtered).map((node) => node.id)).toEqual([
      'Head',
      'Lead',
      'Developer',
    ]);
    expect(developer.children).toEqual([intern]);
  });
  it('keeps active parent context when finding inactive positions', () => {
    expect(
      flattenPositions(filterPositionTree(forest, '', 'inactive')).map((node) => node.id),
    ).toEqual(['Head', 'Analyst']);
  });
  it('builds an ordered ancestry path without looping on malformed data', () => {
    expect(positionPath(intern, flattenPositions(forest)).map((node) => node.id)).toEqual(
      ['Head', 'Lead', 'Developer', 'Intern'],
    );
    const a = position('A', 'B');
    const b = position('B', 'A');
    expect(positionPath(a, [a, b]).map((node) => node.id)).toEqual(['B', 'A']);
  });
  it('excludes self, descendants, and inactive positions from a new parent choice', () => {
    expect(
      availableParents(flattenPositions(forest), lead).map((node) => node.id),
    ).toEqual(['Head']);
    expect(
      availableParents(flattenPositions(forest), null).map((node) => node.id),
    ).not.toContain('Analyst');
  });
  it('starts with three levels visible and keeps empty or unmatched trees empty', () => {
    expect(initialCollapsedPositions(forest)).toEqual(['Developer']);
    expect(filterPositionTree(forest, 'not found', '')).toEqual([]);
    expect(flattenPositions([])).toEqual([]);
  });
  it('permits only valid position connections and leaves seeded positions fixed', () => {
    head.organizationalLevel = 100;
    lead.organizationalLevel = 70;
    developer.organizationalLevel = 50;
    intern.organizationalLevel = 20;
    const sibling = position('Sibling', 'Head');
    sibling.organizationalLevel = 80;
    head.children?.push(sibling);
    const positions = flattenPositions(forest);
    expect(canMoveUnder(developer, sibling, positions)).toBe(true);
    expect(canMoveUnder(developer, intern, positions)).toBe(false);
    expect(canMoveUnder(developer, lead, positions)).toBe(false);
    expect(canMoveUnder(head, developer, positions)).toBe(false);
    sibling.status = 'inactive';
    expect(canMoveUnder(developer, sibling, positions)).toBe(false);
    sibling.status = 'active';
    developer.isSeeded = true;
    expect(canMoveUnder(developer, sibling, positions)).toBe(false);
    developer.isSeeded = false;
  });
  it('inserts above only when there is an available level between parent and child', () => {
    head.organizationalLevel = 100;
    lead.organizationalLevel = 60;
    expect(canAddAbove(lead, flattenPositions(forest))).toBe(true);
    lead.organizationalLevel = 99;
    expect(canAddAbove(lead, flattenPositions(forest))).toBe(false);
    lead.organizationalLevel = 50;
    expect(canAddAbove(head, flattenPositions(forest))).toBe(false);
  });
});
