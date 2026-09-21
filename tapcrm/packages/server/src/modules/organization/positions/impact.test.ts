import { describe, expect, it } from 'vitest';
import {
  describePositionPolicyScope,
  describePositionPolicyScopes,
  toPositionInsertionImpactPreview,
  toPositionPolicyImpactPreview,
  type PositionPolicyForImpact,
  type PositionScopeDescriptionContext,
} from './impact.js';
import type { PositionRecord } from './repository.js';

const position: PositionRecord = {
  id: 'position-1',
  organizationId: 'organization-1',
  departmentId: 'department-1',
  code: 'sales-lead',
  name: 'Sales Team Lead',
  organizationalLevel: 40,
  parentPositionId: 'position-parent',
  isSeeded: false,
  status: 'active',
  maxDealValue: null,
  maxDiscountPercent: null,
  allowsCustomTerms: false,
};

const policy = (
  action: string,
  allowed = true,
  scope = 'team',
  fields: string[] | null = null,
  constraints: string[] | null = null,
): PositionPolicyForImpact => ({ action, allowed, scope, fields, constraints });

const preview = (
  current: PositionPolicyForImpact[],
  proposed: PositionPolicyForImpact[],
  holders: string[] = [],
) => toPositionPolicyImpactPreview(position, current, proposed, holders);

const scopeContext: PositionScopeDescriptionContext = {
  departmentName: 'Revenue Operations',
  teamMemberCount: 14,
  poolMemberCount: 5,
  departmentMemberCount: 31,
  organizationPeopleCount: 74,
  multipleHolderContexts: false,
};

describe('OR-7 position policy impact preview', () => {
  it('previews every re-parented position and preserves independent reporting lines', () => {
    const result = toPositionInsertionImpactPreview(
      {
        code: 'senior-team-lead',
        name: 'Senior Team Lead',
        departmentId: 'department-1',
        organizationalLevel: 50,
        parentPositionId: 'position-parent',
      },
      {
        positionIds: ['team-lead', 'supervisor'],
        holderIds: ['employee-1'],
        parentChanges: [
          {
            positionId: 'team-lead',
            currentParentPositionId: 'position-parent',
            proposedParentPositionId: null,
          },
        ],
        reportingRelationships: [{ userId: 'employee-1', reportsTo: 'manager-1' }],
      },
    );

    expect(result.requiresConfirmation).toBe(true);
    expect(result.positionParentChanges).toHaveLength(1);
    expect(result.affectedPositionIds).toEqual(['team-lead', 'supervisor']);
    expect(result.reportingRelationships).toEqual([
      {
        userId: 'employee-1',
        currentReportsTo: 'manager-1',
        proposedReportsTo: 'manager-1',
        changed: false,
      },
    ]);
  });

  it('reports no capability or policy change for an identical policy set', () => {
    const result = preview([policy('leads:view')], [policy('leads:view')]);
    expect(result.capabilitiesAdded).toEqual([]);
    expect(result.capabilitiesRemoved).toEqual([]);
    expect(result.policyChanges).toEqual([]);
    expect(result.requiresConfirmation).toBe(false);
  });

  it('reports newly allowed capabilities and excludes denied policies', () => {
    const result = preview([], [policy('leads:assign'), policy('leads:delete', false)]);
    expect(result.capabilitiesAdded).toEqual(['leads:assign']);
    expect(result.capabilitiesRemoved).toEqual([]);
  });

  it('reports a removed allowed capability when it becomes denied', () => {
    const result = preview([policy('leads:delete')], [policy('leads:delete', false)]);
    expect(result.capabilitiesAdded).toEqual([]);
    expect(result.capabilitiesRemoved).toEqual(['leads:delete']);
  });

  it('reports scope-only changes without pretending the capability changed', () => {
    const result = preview(
      [policy('leads:view', true, 'team')],
      [policy('leads:view', true, 'department')],
    );
    expect(result.capabilitiesAdded).toEqual([]);
    expect(result.capabilitiesRemoved).toEqual([]);
    expect(result.scopeChanges).toEqual([
      { action: 'leads:view', from: 'team', to: 'department' },
    ]);
  });

  it('reports exact mixed capability changes and field/constraint changes', () => {
    const result = preview(
      [
        policy('leads:delete'),
        policy('leads:edit', true, 'team', ['title'], ['assigned']),
      ],
      [
        policy('leads:view'),
        policy('leads:assign'),
        policy('leads:delete', false),
        policy('leads:edit', true, 'team', ['title', 'source'], ['assigned', 'open']),
      ],
    );
    expect(result.capabilitiesAdded).toEqual(['leads:assign', 'leads:view']);
    expect(result.capabilitiesRemoved).toEqual(['leads:delete']);
    expect(result.policyChanges).toEqual(
      expect.arrayContaining([
        {
          action: 'leads:edit',
          allowedChanged: false,
          fieldsChanged: true,
          constraintsChanged: true,
        },
      ]),
    );
  });

  it('includes only the direct active holders supplied by the tenant-safe repository query', () => {
    const result = preview([], [policy('leads:view')], ['user-1', 'user-2']);
    expect(result.holderCount).toBe(2);
    expect(result.affectedPositionIds).toEqual(['position-1']);
    expect(result.affectedHolderIds).toEqual(['user-1', 'user-2']);
    expect(result.reportingRelationships).toEqual([]);
    expect(result.preview).toBe(true);
  });

  it('does not mutate either policy set while calculating a preview', () => {
    const current = [policy('leads:view', true, 'team', ['title'])];
    const proposed = [policy('leads:view', true, 'department', ['title', 'source'])];
    const before = JSON.stringify({ current, proposed });

    preview(current, proposed, ['user-1']);

    expect(JSON.stringify({ current, proposed })).toBe(before);
  });
});

describe('OR-8 human-readable position policy scope', () => {
  it.each([
    ['own', 'Sales Team Lead can view their own leads.'],
    ['participant', 'Sales Team Lead can view leads where they are a participant.'],
    ['pool', 'Sales Team Lead can view leads belonging to 5 people in their pool.'],
    ['team', 'Sales Team Lead can view leads belonging to 14 people in their team.'],
    [
      'department',
      'Sales Team Lead can view leads belonging to 31 people in the Revenue Operations department.',
    ],
    [
      'all-people',
      'Sales Team Lead can view leads for 74 people across the organization.',
    ],
  ] as const)(
    'explains the %s scope from the authorization vocabulary',
    (scope, description) => {
      expect(
        describePositionPolicyScope(
          position,
          policy('leads:view', true, scope),
          scopeContext,
        ).description,
      ).toBe(description);
    },
  );

  it('does not imply access for a denied policy', () => {
    const result = describePositionPolicyScope(
      position,
      policy('leads:view', false),
      scopeContext,
    );
    expect(result.description).toBe('This permission is currently disabled.');
    expect(result.peopleCount).toBeNull();
  });

  it('keeps current and proposed scope descriptions distinct for an OR-7 scope change', () => {
    const result = describePositionPolicyScopes(
      position,
      [policy('leads:view', true, 'team')],
      [policy('leads:view', true, 'department')],
      scopeContext,
    );
    expect(result.current[0]?.description).toContain('14 people in their team');
    expect(result.proposed[0]?.description).toContain('Revenue Operations department');
  });

  it('uses the actual position name and supplied counts without Sales-specific hardcoding', () => {
    const engineeringPosition = { ...position, name: 'Delivery Coordinator' };
    const result = describePositionPolicyScope(
      engineeringPosition,
      policy('leads:view', true, 'team'),
      { ...scopeContext, teamMemberCount: 1 },
    );
    expect(result.description).toBe(
      'Delivery Coordinator can view leads belonging to 1 person in their team.',
    );
  });

  it('handles missing scope populations without fabricating a count', () => {
    const result = describePositionPolicyScope(
      position,
      policy('leads:view', true, 'team'),
      { ...scopeContext, teamMemberCount: null },
    );
    expect(result.peopleCount).toBeNull();
    expect(result.description).toBe(
      'Sales Team Lead can view leads belonging to people in their team.',
    );
  });

  it('does not mutate policy or context while generating an explanation', () => {
    const input = policy('leads:view', true, 'department');
    const before = JSON.stringify({ input, scopeContext });
    describePositionPolicyScope(position, input, scopeContext);
    expect(JSON.stringify({ input, scopeContext })).toBe(before);
  });
});
