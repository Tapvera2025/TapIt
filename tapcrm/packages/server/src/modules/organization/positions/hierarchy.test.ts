import { describe, expect, it } from 'vitest';
import { assertPositionApprovalLimits, assertPositionLevel } from './hierarchy.js';

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
