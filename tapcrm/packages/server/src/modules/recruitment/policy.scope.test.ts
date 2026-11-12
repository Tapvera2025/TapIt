import { describe, expect, it } from 'vitest';
import { __resetResourcePolicies, MATCH_NOTHING, type PolicyEvaluationContext } from '@tapcrm/authz';
import { candidatePolicy, interviewPolicy, jobRequisitionPolicy } from './policy.js';
import { roleChangeRequestPolicy } from '../organization/policy.js';

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

describe('recruitment and role-change people route', () => {
  it('pool/team are no longer MATCH_NOTHING for recruitment resources', async () => {
    for (const policy of [candidatePolicy, interviewPolicy, jobRequisitionPolicy]) {
      for (const scope of ['pool', 'team'] as const) {
        const f = await policy.filter(fakeCtx(), 'x' as never, scope);
        expect(f === MATCH_NOTHING).toBe(false);
        expect(f.sql).toContain('created_by = ANY(');
      }
      expect((await policy.filter(fakeCtx(), 'x' as never, 'all-people')) === MATCH_NOTHING).toBe(true);
    }
  });
  it('a candidate created by a report is reachable at team scope, a stranger\'s is not', async () => {
    const rec = { type: 'candidate', id: 'c', organizationId: ORG, createdBy: REPORT };
    expect(await candidatePolicy.check(fakeCtx(), 'x' as never, rec, 'team')).toBe(true);
    expect(await candidatePolicy.check(fakeCtx(), 'x' as never, { ...rec, createdBy: OTHER }, 'team')).toBe(false);
    expect(await candidatePolicy.check(fakeCtx(), 'x' as never, rec, 'participant')).toBe(false);
  });
  it('an interview whose panel includes a report is reachable at pool scope', async () => {
    const rec = { type: 'interview', id: 'i', organizationId: ORG, createdBy: OTHER, interviewerIds: [REPORT] };
    expect(await interviewPolicy.check(fakeCtx(), 'x' as never, rec, 'pool')).toBe(true);
    const f = await interviewPolicy.filter(fakeCtx(), 'x' as never, 'pool');
    expect(f.sql).toContain('interview_interviewer');
  });
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
