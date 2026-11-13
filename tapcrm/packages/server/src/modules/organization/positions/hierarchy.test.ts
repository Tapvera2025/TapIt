import { describe, expect, it } from 'vitest';
import {
  assertPositionApprovalLimits,
  assertPositionLevel,
  canBecomeDepartmentTop,
  selectPositionsToAdopt,
} from './hierarchy.js';

const position = (overrides: Record<string, unknown> = {}) => ({
  id: 'child-position',
  name: 'Child position',
  organizationId: 'organization-1',
  departmentId: 'department-1',
  code: 'child',
  organizationalLevel: 40,
  parentPositionId: 'parent-position',
  isSeeded: false,
  status: 'active' as const,
  maxDealValue: null,
  maxDiscountPercent: null,
  allowsCustomTerms: false,
  ...overrides,
});

describe('OR-4 custom position constraints', () => {
  it('rejects invalid parent and child organizational levels', () => {
    expect(() =>
      assertPositionLevel({
        position: 'position-1',
        level: 50,
        parent: position({
          id: 'parent-position',
          name: 'Parent',
          organizationalLevel: 50,
        }),
        children: [],
      }),
    ).toThrow(/lower organizational level/i);
    expect(() =>
      assertPositionLevel({
        position: 'position-1',
        level: 30,
        parent: position({
          id: 'parent-position',
          name: 'Parent',
          organizationalLevel: 90,
        }),
        children: [position({ organizationalLevel: 30 })],
      }),
    ).toThrow(/higher organizational level/i);
  });

  it('prevents reducing a parent below an existing child approval limit', () => {
    expect(() =>
      assertPositionApprovalLimits({
        positionId: 'parent-position',
        maxDealValue: 100,
        maxDiscountPercent: 10,
        allowsCustomTerms: false,
        children: [position({ maxDealValue: 125, maxDiscountPercent: 15 })],
      }),
    ).toThrow(/cannot fall below child/i);
  });

  it('prevents disabling custom terms required by a child', () => {
    expect(() =>
      assertPositionApprovalLimits({
        positionId: 'parent-position',
        maxDealValue: null,
        maxDiscountPercent: null,
        allowsCustomTerms: false,
        children: [position({ allowsCustomTerms: true })],
      }),
    ).toThrow(/custom terms/i);
  });
});

describe('targeted position insertion', () => {
  const siblings = [
    position({ id: 'selected', organizationalLevel: 40 }),
    position({ id: 'sibling', organizationalLevel: 35 }),
  ];

  it('adopts only the selected direct child, leaving its sibling in place', () => {
    expect(selectPositionsToAdopt(siblings, {
      parentPositionId: 'parent-position',
      organizationalLevel: 50,
      adoptLowerPositions: false,
      adoptPositionIds: ['selected'],
    }).map(({ id }) => id)).toEqual(['selected']);
  });

  it('rejects a child under another parent or one with no available level', () => {
    const request = {
      parentPositionId: 'parent-position',
      organizationalLevel: 50,
      adoptLowerPositions: false,
      adoptPositionIds: ['selected'],
    };
    expect(() => selectPositionsToAdopt([
      position({ id: 'selected', parentPositionId: 'other-parent' }),
    ], request)).toThrow(/direct child/i);
    expect(() => selectPositionsToAdopt([
      position({ id: 'selected', organizationalLevel: 50 }),
    ], request)).toThrow(/below the new level/i);
  });

  it('keeps the seeded hierarchy immutable', () => {
    expect(() => selectPositionsToAdopt([
      position({ id: 'selected', isSeeded: true }),
    ], {
      parentPositionId: 'parent-position',
      organizationalLevel: 50,
      adoptLowerPositions: false,
      adoptPositionIds: ['selected'],
    })).toThrow(/seeded position hierarchy/i);
  });
});

describe('department top position', () => {
  const currentTop = position({
    id: 'senior-designer',
    name: 'Senior Graphic Designer',
    organizationalLevel: 60,
    parentPositionId: null,
  });
  const noAdoption = { adoptLowerPositions: false, adoptPositionIds: [] as string[] };

  it("lets a department's first position report to the Super Admin", () => {
    expect(canBecomeDepartmentTop([], { organizationalLevel: 60, ...noAdoption })).toBe(
      true,
    );
    expect(
      canBecomeDepartmentTop([position({ parentPositionId: null, status: 'inactive' })], {
        organizationalLevel: 10,
        ...noAdoption,
      }),
    ).toBe(true);
  });

  it('lets a more senior position take over as the top, moving the current top under it', () => {
    expect(
      canBecomeDepartmentTop([currentTop], {
        organizationalLevel: 80,
        adoptLowerPositions: false,
        adoptPositionIds: ['senior-designer'],
      }),
    ).toBe(true);
  });

  it('refuses a second, unconnected top that takes nothing under it', () => {
    expect(
      canBecomeDepartmentTop([currentTop], { organizationalLevel: 80, ...noAdoption }),
    ).toBe(false);
    expect(
      canBecomeDepartmentTop([currentTop], {
        organizationalLevel: 60,
        adoptLowerPositions: true,
        adoptPositionIds: [],
      }),
    ).toBe(false);
  });
});
