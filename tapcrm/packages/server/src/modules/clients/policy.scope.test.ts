import { beforeEach, describe, expect, it } from 'vitest';
import { __resetResourcePolicies, MATCH_NOTHING, policyFor, type PolicyEvaluationContext } from '@tapcrm/authz';
import { registerClientPolicies } from './policy.js';
import { registerProjectPolicies } from '../projects/policy.js';

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

describe('client and project scope reach', () => {
  beforeEach(() => {
    __resetResourcePolicies();
    registerClientPolicies();
    registerProjectPolicies();
  });

  for (const type of ['client', 'project'] as const) {
    const assigneeField = type === 'client' ? 'projectAssigneeIds' : 'assigneeIds';
    const resource = (createdBy: string, assignees: string[]) => ({ type, id: 'x', organizationId: ORG, createdBy, [assigneeField]: assignees });

    it(`${type}: pool/team/department filters are no longer scope-blind`, async () => {
      const policy = policyFor(type);
      for (const scope of ['pool', 'team', 'department'] as const) {
        const f = await policy.filter(fakeCtx(), 'x' as never, scope);
        expect(f === MATCH_NOTHING).toBe(false);
        expect(f.sql).toContain('= ANY(');
        expect(f.sql).toContain('created_by');
      }
      const own = await policy.filter(fakeCtx(), 'x' as never, 'own');
      expect(own.parameters).toEqual([ME]);
      expect((await policy.filter(fakeCtx(), 'x' as never, 'all-people')) === MATCH_NOTHING).toBe(true);
    });

    it(`${type}: a record created by or assigned to a report is reachable at team scope, a stranger's is not`, async () => {
      const policy = policyFor(type);
      expect(await policy.check(fakeCtx(), 'x' as never, resource(REPORT, []), 'team')).toBe(true);
      expect(await policy.check(fakeCtx(), 'x' as never, resource(OTHER, [REPORT]), 'department')).toBe(true);
      expect(await policy.check(fakeCtx(), 'x' as never, resource(OTHER, [OTHER]), 'team')).toBe(false);
      expect(await policy.check(fakeCtx(), 'x' as never, resource(REPORT, []), 'own')).toBe(false);
      expect(await policy.check(fakeCtx(), 'x' as never, resource(REPORT, []), 'all-people')).toBe(false);
    });
  }
});
