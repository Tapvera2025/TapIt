import {
  or,
  scopeMemberFilter,
  scopeReachesAny,
  type Resource,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';

/**
 * Adds the "people route" to a people-domain policy whose structural check
 * only compares the subject's team / pool / department COLUMN with the
 * caller's ids.
 *
 * Column matching alone misses people who are in the caller's reach without
 * sharing a column value: a lead's reporting line, the members of a team the
 * caller leads but does not sit in. For `pool`, `team` and `department` the
 * record is also reachable when its subject is one of the scope's people
 * (`scopeMemberIds`). `own` / `participant` / `all-people` are left to the
 * wrapped policy exactly as it defines them.
 */
export function withPeopleReach(
  policy: ResourcePolicy,
  options: {
    /** The resource field(s) naming the subject person(s). */
    subjects: readonly string[];
    /** Fully qualified column(s) of the subject in list filters, e.g. `u.id`. */
    columns: readonly string[];
    /** Actions whose object check must stay exactly as the wrapped policy decides. */
    keepCheckFor?: (action: Action) => boolean;
  },
): ResourcePolicy {
  const reaches = (scope: Scope) => scope === 'pool' || scope === 'team' || scope === 'department';
  return {
    ...policy,
    async check(ctx, action, resource: Resource, scope) {
      if (await policy.check(ctx, action, resource, scope)) return true;
      if (!reaches(scope) || options.keepCheckFor?.(action)) return false;
      if (resource['organizationId'] !== ctx.organizationId) return false;
      const people = options.subjects.map((field) => resource[field]).filter((v): v is string => typeof v === 'string');
      return scopeReachesAny(ctx, scope, people);
    },
    async filter(ctx, action, scope) {
      const structural = await policy.filter(ctx, action, scope);
      if (!reaches(scope)) return structural;
      return or(structural, await scopeMemberFilter(ctx, scope, options.columns));
    },
  };
}
