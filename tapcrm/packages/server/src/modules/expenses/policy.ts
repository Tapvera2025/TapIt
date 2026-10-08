import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

export const makeExpenseResource = (id: string, organizationId: string, claimedBy: string, departmentId: string | null = null, teamId: string | null = null) => ({ type: 'expenseClaim' as const, id, organizationId, subjectId: claimedBy, userId: claimedBy, claimedBy, departmentId, teamId });

const policy: ResourcePolicy = {
  resourceType: 'expenseClaim', domain: 'people',
  async check(ctx, action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    const owner = resource['claimedBy'] === ctx.principal.id;
    if (action === 'payables:approve-claim') return !owner && (scope === 'all-people' || scope === 'department' || scope === 'team' || scope === 'pool');
    if (scope === 'all-people') return true;
    if (scope === 'own') return owner;
    return false;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'c.claimed_by = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') { const id = await ctx.scope.departmentId(ctx); return id ? { sql: 'u.department_id = $1', parameters: [id] } : MATCH_NOTHING; }
    if (scope === 'team' || scope === 'pool') { const ids = scope === 'team' ? await ctx.scope.teamIds(ctx) : await ctx.scope.poolIds(ctx); return ids.size ? { sql: 'u.team_id = ANY($1::uuid[])', parameters: [[...ids]] } : MATCH_NOTHING; }
    return MATCH_NOTHING;
  },
  participantFields: () => ['claimedBy', 'reviewedBy'],
  initiatorField: () => 'claimedBy',
};

export function registerExpensePolicies(): void { registerResourcePolicy(policy); }
