import { describe, expect, it } from 'vitest';
import { MATCH_NOTHING, type PolicyEvaluationContext } from '@tapcrm/authz';
import { roleChangeRequestPolicy } from './policy.js';

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

describe('role-change people route', () => {
  it('role change requests reach the subject or requester at pool/team/department', async () => {
    for (const scope of ['pool', 'team', 'department'] as const) {
      const f = await roleChangeRequestPolicy.filter(fakeCtx(), 'x' as never, scope);
      expect(f === MATCH_NOTHING).toBe(false);
      expect(f.sql).toContain('subject_user_id');
      expect(f.sql).toContain('requested_by');
    }
    const rec = { type: 'roleChangeRequest', id: 'r', organizationId: ORG, subjectUserId: REPORT, requestedBy: OTHER, departmentId: 'dept-9' };
    expect(await roleChangeRequestPolicy.check(fakeCtx(), 'x' as never, rec, 'team')).toBe(true);
    expect(await roleChangeRequestPolicy.check(fakeCtx(), 'x' as never, { ...rec, subjectUserId: OTHER }, 'team')).toBe(false);
  });
});
