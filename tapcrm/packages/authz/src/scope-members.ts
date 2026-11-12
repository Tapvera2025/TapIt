import type { Scope, UserId } from '@tapcrm/contracts';
import type { PolicyEvaluationContext } from './ports.js';
import { MATCH_ALL, MATCH_NOTHING, or, type SqlFragment } from './sql.js';

/**
 * Person-based scope reach, shared by every ResourcePolicy whose records belong
 * to people (an owner, a creator, an assignee, a subject).
 *
 * Before this helper each policy re-derived "who is in my team" on its own,
 * and several got it wrong in different ways — matching only a team column a
 * record might never have been stamped with, or ignoring the scope altogether
 * so "their department" meant the same as "just their own". One definition,
 * used everywhere, is how a granted scope means the same thing on every screen.
 *
 *   own / participant → the principal
 *   pool              → their own team(s) only, plus their direct reports (VIS-4)
 *   team              → every team at or below theirs, plus their whole
 *                       reporting line (VIS-1 is transitive)
 *   department        → everyone in their department
 *   all-people        → everyone (people-domain resources only; PD-1)
 *
 * Returns `null` for `all-people`: the reach is not a set of people but the
 * whole tenant, and the caller decides what that means for its resource.
 */
export async function scopeMemberIds(
  ctx: PolicyEvaluationContext,
  scope: Scope,
): Promise<ReadonlySet<UserId> | null> {
  switch (scope) {
    case 'own':
    case 'participant':
      return new Set<UserId>([ctx.principal.id]);
    case 'pool':
      return withSelf(ctx, await ctx.scope.poolMemberIds(ctx));
    case 'team':
      return withSelf(ctx, await ctx.scope.teamMemberIds(ctx));
    case 'department':
      return withSelf(ctx, await ctx.scope.departmentMemberIds(ctx));
    case 'all-people':
      return null;
  }
}

function withSelf(ctx: PolicyEvaluationContext, ids: ReadonlySet<UserId>): ReadonlySet<UserId> {
  if (ids.has(ctx.principal.id)) return ids;
  return new Set<UserId>([...ids, ctx.principal.id]);
}

/** Object check: does any of the record's people fall inside the scope? */
export async function scopeReachesAny(
  ctx: PolicyEvaluationContext,
  scope: Scope,
  people: readonly (string | null | undefined)[],
  options: { allPeople?: boolean } = {},
): Promise<boolean> {
  const members = await scopeMemberIds(ctx, scope);
  if (members === null) return options.allPeople === true;
  return people.some((id) => typeof id === 'string' && members.has(id));
}

/**
 * List filter: any of `columns` (fully qualified, e.g. `l.owner_id`) names a
 * person inside the scope. Never returns an empty predicate (AZ-I2).
 */
export async function scopeMemberFilter(
  ctx: PolicyEvaluationContext,
  scope: Scope,
  columns: readonly string[],
  options: { allPeople?: boolean } = {},
): Promise<SqlFragment> {
  if (columns.length === 0) return MATCH_NOTHING;
  const members = await scopeMemberIds(ctx, scope);
  if (members === null) return options.allPeople === true ? MATCH_ALL : MATCH_NOTHING;
  if (members.size === 0) return MATCH_NOTHING;
  const ids = [...members];
  return or(...columns.map((column) => ({ sql: `${column} = ANY($1::uuid[])`, parameters: [ids] })));
}
