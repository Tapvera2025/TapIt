import { describe, expect, it } from 'vitest';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import { attendanceRecordPolicy } from './policy.js';

/** §8.7: the `attendanceRecord` policy mirrors `userPolicy`, keyed on the record's subject. */

const organizationId = 'organization-1';

function context(): PolicyEvaluationContext {
  return {
    organizationId,
    requestId: 'request-1',
    memo: new Map(),
    principal: {
      id: 'employee-1',
      organizationId,
      accountType: 'employee',
      departmentId: 'department-1',
      teamId: 'team-1',
    } as PolicyEvaluationContext['principal'],
    scope: {
      departmentId: async () => 'department-1',
      teamIds: async () => new Set(['team-1', 'team-2']),
      poolIds: async () => new Set(['team-3']),
      subordinateIds: async () => new Set<string>(),
      poolMemberIds: async () => new Set<string>(),
    },
  };
}

/** The loader's shape: `{ type, id: userId, userId, departmentId, teamId, organizationId }`. */
function subject(overrides: Record<string, unknown> = {}) {
  const base = {
    type: 'attendanceRecord',
    id: 'employee-2',
    userId: 'employee-2',
    organizationId,
    departmentId: 'department-1',
    teamId: 'team-2',
    ...overrides,
  };
  return { ...base, id: base.userId };
}

const check = (scope: Scope, overrides: Record<string, unknown> = {}) =>
  attendanceRecordPolicy.check(context(), 'attendance:view', subject(overrides), scope);

describe('attendanceRecord policy (§8.7)', () => {
  it.each<Scope>(['own', 'department', 'team', 'pool', 'all-people'])(
    'never reaches another organization (%s)',
    async (scope) => {
      await expect(check(scope, { organizationId: 'organization-2' })).resolves.toBe(
        false,
      );
    },
  );

  it('own: only the caller’s own days', async () => {
    await expect(check('own', { userId: 'employee-1' })).resolves.toBe(true);
    await expect(check('own')).resolves.toBe(false);
  });

  it('department, team and pool follow the subject’s placement', async () => {
    await expect(check('department')).resolves.toBe(true);
    await expect(check('department', { departmentId: 'department-9' })).resolves.toBe(
      false,
    );
    await expect(check('team')).resolves.toBe(true);
    await expect(check('team', { teamId: 'team-9' })).resolves.toBe(false);
    await expect(check('pool', { teamId: 'team-3' })).resolves.toBe(true);
    await expect(check('pool')).resolves.toBe(false);
    await expect(check('team', { teamId: null })).resolves.toBe(false);
  });

  it('all-people sees everyone in the organization', async () => {
    await expect(check('all-people', { departmentId: 'department-9' })).resolves.toBe(
      true,
    );
  });

  it.each<[Scope, { sql: string; parameters: unknown[] }]>([
    ['own', { sql: 'u.id = $1', parameters: ['employee-1'] }],
    ['department', { sql: 'u.department_id = $1', parameters: ['department-1'] }],
    ['team', { sql: 'u.team_id = ANY($1::uuid[])', parameters: [['team-1', 'team-2']] }],
    ['pool', { sql: 'u.team_id = ANY($1::uuid[])', parameters: [['team-3']] }],
    ['all-people', { sql: 'TRUE', parameters: [] }],
  ])(
    'filters %s over the joined person (app_user u), as userPolicy does',
    async (scope, expected) => {
      await expect(
        attendanceRecordPolicy.filter(context(), 'attendance:view', scope),
      ).resolves.toEqual(expected);
    },
  );
});
