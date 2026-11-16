import {
  MATCH_ALL,
  MATCH_NOTHING,
  registerResourcePolicy,
  scopeMemberFilter,
  scopeReachesAny,
  type ResourcePolicy,
} from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';

export const makeAdvanceResource = (
  id: string,
  organizationId: string,
  employeeId: string,
  requestedBy = employeeId,
) => ({
  type: 'employeeAdvance' as const,
  id,
  organizationId,
  subjectId: employeeId,
  userId: employeeId,
  requestedBy,
});

const policy: ResourcePolicy = {
  resourceType: 'employeeAdvance',
  domain: 'people',
  // Reach follows the scope like every other people record: all-people (HR)
  // sees every advance, a team / department grant sees that scope's people,
  // own sees the holder's. Before, the list returned EVERY advance for team and
  // pool grants while the single-record check ignored the scope entirely.
  async check(ctx, action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (globalAccess(ctx.principal) || scope === 'all-people') return true;
    const subject = resource['subjectId'] as string | null;
    const requester = resource['requestedBy'] as string | null;
    const manages = action === 'advance:approve' || action === 'advance:manage' || action === 'advance:export';
    if (scope === 'own') return !manages && (subject === ctx.principal.id || requester === ctx.principal.id);
    if (scope === 'participant') return subject === ctx.principal.id || requester === ctx.principal.id;
    return scopeReachesAny(ctx, scope, [subject]);
  },
  // The list filter for GET /api/advances and the deduction lists. Columns
  // are qualified with `a.`, the employee_advance alias in every advance list
  // query (service.ts), and each predicate is bracketed so it composes safely
  // with the query's own AND conditions. It mirrors `check` above: `own` never
  // reaches the approve/manage/export actions.
  async filter(ctx, action, scope) {
    if (scope === 'all-people') return MATCH_ALL;
    const manages = action === 'advance:approve' || action === 'advance:manage' || action === 'advance:export';
    if (scope === 'own') {
      if (manages) return MATCH_NOTHING;
      return { sql: '(a.employee_id = $1)', parameters: [ctx.principal.id] };
    }
    if (scope === 'participant')
      return {
        sql: '(a.employee_id = $1 OR a.created_by = $1 OR a.approved_by = $1 OR a.rejected_by = $1)',
        parameters: [ctx.principal.id],
      };
    if (scope === 'team' || scope === 'department' || scope === 'pool')
      return scopeMemberFilter(ctx, scope, ['a.employee_id']);
    return MATCH_NOTHING;
  },
  participantFields: () => ['requestedBy', 'approvedBy', 'rejectedBy'],
  initiatorField: (action) => (action === 'advance:approve' ? 'requestedBy' : null),
};
export function registerAdvancePolicies(): void {
  registerResourcePolicy(policy);
}
