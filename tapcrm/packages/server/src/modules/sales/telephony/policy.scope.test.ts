import { describe, expect, it } from 'vitest';
import { type PolicyEvaluationContext } from '@tapcrm/authz';
import { telephonyCallPolicy } from './policy.js';

const ORG = 'org-1';
const ME = 'user-me';
const REPORT = 'user-report';
const OTHER = 'user-other';

function fakeCtx(): PolicyEvaluationContext {
  const set = (...ids: string[]) => new Set<string>(ids);
  return {
    principal: { id: ME, accountType: 'employee', organizationId: ORG, positionId: 'p', departmentId: 'dept-1', teamId: 'team-1', reportsTo: null, organizationalLevel: 5 },
    organizationId: ORG,
    requestId: 'r',
    memo: new Map(),
    scope: {
      subordinateIds: async () => set(REPORT),
      teamIds: async () => set('team-1'),
      poolIds: async () => set('team-1'),
      poolMemberIds: async () => set(ME, REPORT),
      teamMemberIds: async () => set(ME, REPORT),
      departmentMemberIds: async () => set(ME, REPORT),
      departmentId: async () => 'dept-1',
    },
  } as unknown as PolicyEvaluationContext;
}

describe('telephonyCall scope reach', () => {
  it('team and pool filters match the employee by id as well as by team column', async () => {
    for (const scope of ['team', 'pool', 'department'] as const) {
      const f = await telephonyCallPolicy.filter(fakeCtx(), 'x' as never, scope);
      expect(f.sql).toContain('emp.id = ANY(');
    }
  });
  it('a call by a report who sits in another team is reachable at team scope', async () => {
    const call = { type: 'telephonyCall', id: 'c', organizationId: ORG, employeeId: REPORT, teamId: 'team-9', departmentId: 'dept-9' };
    expect(await telephonyCallPolicy.check(fakeCtx(), 'x' as never, call, 'team')).toBe(true);
    expect(await telephonyCallPolicy.check(fakeCtx(), 'x' as never, { ...call, employeeId: OTHER }, 'team')).toBe(false);
  });
});
