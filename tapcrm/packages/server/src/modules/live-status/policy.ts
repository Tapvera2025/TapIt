import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

/**
 * `userStatus` — the live-board resource. Mirrors `userPolicy` (§9.4):
 *
 *   own          the caller alone
 *   team         the caller's teams
 *   department   the caller's department
 *   pool         the caller's pool teams
 *   all-people   everyone in the tenant
 *
 * The filter targets `app_user u`. `listBoard` in the repo joins
 * `app_user u ON u.id = r.user_id` so the filter can reach
 * `u.department_id` / `u.team_id`. This is CURRENT placement — the same
 * source the projector's routing subject uses (see `channel.ts`,
 * `repo.currentRoutingSubject`), so a lead's HTTP board and their
 * socket-pushed board agree.
 */
const baseUserStatusPolicy: ResourcePolicy = {
  resourceType: 'userStatus',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    if (scope === 'department') {
      return resource['departmentId'] === (await ctx.scope.departmentId(ctx));
    }
    const teamId = resource['teamId'];
    if (typeof teamId !== 'string') return false;
    if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(teamId);
    if (scope === 'pool') return (await ctx.scope.poolIds(ctx)).has(teamId);
    return false;
  },
  async filter(ctx, _action, scope) {
    if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
    if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
    if (scope === 'department') {
      const departmentId = await ctx.scope.departmentId(ctx);
      return departmentId === null
        ? MATCH_NOTHING
        : { sql: 'u.department_id = $1', parameters: [departmentId] };
    }
    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      return teams.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
    }
    if (scope === 'pool') {
      const pools = [...(await ctx.scope.poolIds(ctx))];
      return pools.length === 0
        ? MATCH_NOTHING
        : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [pools] };
    }
    return MATCH_NOTHING;
  },
  participantFields() {
    return [];
  },
  initiatorField() {
    return null;
  },
};

// No people route here: the live board's HTTP filter and its socket rooms must
// reach the same people (scope-agreement.test.ts), and rooms are keyed on team
// and department placement. Team leads still reach the teams they lead, because
// both paths read `teamIds` / `poolIds` from the same scope resolver.
export const userStatusPolicy: ResourcePolicy = baseUserStatusPolicy;

export function registerLiveStatusPolicies(): void {
  registerResourcePolicy(userStatusPolicy);
}
