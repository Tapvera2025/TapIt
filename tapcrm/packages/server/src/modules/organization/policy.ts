import type { Action } from '@tapcrm/contracts';
import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type ResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import { toCamel } from '../../platform/dal/mapping.js';

/**
 * ResourcePolicies for the `organization` module.
 *
 * AZ-I7b requires `filter` and `check` to AGREE: a property test per policy
 * generates representative records and asserts that every filtered record
 * passes the object check, and every permitted record is represented by the
 * filter. Writing them as one `predicate` used by both is how that agreement is
 * kept structural rather than tested-into-existence.
 */

/** Shared shape: an org-structure record scoped by department. */
function departmentScoped(
  resourceType: string,
  table: string,
  departmentColumn = 'department_id',
  domain: 'business' | 'people' = 'business',
): ResourcePolicy {
  const predicate = async (
    ctx: PolicyEvaluationContext,
    resource: Resource | null,
    scope: Scope,
  ): Promise<{ ok: boolean; fragment: SqlFragment }> => {
    switch (scope) {
      case 'department': {
        const departmentId = await ctx.scope.departmentId(ctx);
        if (departmentId === null) return { ok: false, fragment: MATCH_NOTHING };
        return {
          ok:
            resource === null
              ? true
              : resource[toCamel(departmentColumn)] === departmentId,
          fragment: {
            sql: `${table}.${departmentColumn} = $1`,
            parameters: [departmentId],
          },
        };
      }

      case 'team': {
        const teams = [...(await ctx.scope.teamIds(ctx))];
        if (teams.length === 0) return { ok: false, fragment: MATCH_NOTHING };
        return {
          ok:
            resource === null
              ? true
              : typeof resource['teamId'] === 'string' &&
                teams.includes(resource['teamId']),
          fragment: {
            sql: `${table}.team_id = ANY($1::uuid[])`,
            parameters: [teams],
          },
        };
      }

      case 'own':
        return {
          ok: resource === null ? true : resource['id'] === ctx.principal.id,
          fragment: { sql: `${table}.id = $1`, parameters: [ctx.principal.id] },
        };

      // `all-people` reaches every employee record but only for PEOPLE-domain
      // resources. The engine has already refused it against a business-domain
      // resource at step 7 (PD-1) before this is called.
      case 'all-people':
        return { ok: true, fragment: { sql: 'TRUE', parameters: [] } };

      // AZ-3 — "A denied action produces a filter matching nothing, never an
      // empty filter matching everything."
      default:
        return { ok: false, fragment: MATCH_NOTHING };
    }
  };

  return {
    resourceType,
    // §5.3 group "Org". org:view-structure and the manage-* actions are
    // business-domain per AUTHORIZATION.md §6.4; org:view-people is people.
    // The resource's own domain is what the engine checks, and these describe
    // the shape of the company rather than a person's record.
    domain,

    async check(ctx, _action, resource, scope) {
      return (await predicate(ctx, resource, scope)).ok;
    },

    async filter(ctx, _action, scope) {
      return (await predicate(ctx, null, scope)).fragment;
    },

    participantFields(): readonly string[] {
      return [];
    },

    initiatorField(): string | null {
      return null;
    },
  };
}

/** `role_change_request` — the module's one approval-bearing resource. */
const roleChangeRequestPolicy: ResourcePolicy = {
  resourceType: 'roleChangeRequest',
  domain: 'business',

  async check(ctx, _action, resource, scope) {
    switch (scope) {
      case 'own':
        return resource['requestedBy'] === ctx.principal.id;
      case 'participant':
        return (
          resource['requestedBy'] === ctx.principal.id ||
          resource['subjectUserId'] === ctx.principal.id
        );
      case 'department': {
        const departmentId = await ctx.scope.departmentId(ctx);
        return departmentId !== null && resource['departmentId'] === departmentId;
      }
      default:
        return false;
    }
  },

  async filter(ctx, _action, scope) {
    switch (scope) {
      case 'own':
        return {
          sql: 'role_change_request.requested_by = $1',
          parameters: [ctx.principal.id],
        };
      case 'participant':
        return {
          sql: '(role_change_request.requested_by = $1 OR role_change_request.subject_user_id = $1)',
          parameters: [ctx.principal.id],
        };
      default:
        return MATCH_NOTHING;
    }
  },

  participantFields(): readonly string[] {
    // camelCase: these name fields on the DOMAIN object, not columns (§5.1).
    return ['requestedBy', 'subjectUserId'];
  },

  /**
   * A1 / §4.1.1 — "There is no universal `raisedBy` field, and assuming one
   * would silently disable the control on every resource that names its
   * initiator differently — which is most of them."
   *
   * The registry declares `requestedBy` for `access:decide-role-change`; this
   * is the resource-side half of the same contract.
   */
  initiatorField(action: Action): string | null {
    return action === 'access:decide-role-change' ? 'requestedBy' : null;
  },
};

export function registerOrganizationPolicies(): void {
  registerResourcePolicy(departmentScoped('department', 'department', 'id'));
  registerResourcePolicy(departmentScoped('position', 'position'));
  registerResourcePolicy(departmentScoped('team', 'team'));
  registerResourcePolicy(departmentScoped('designation', 'designation'));
  registerResourcePolicy(departmentScoped('user', 'app_user', 'department_id', 'people'));
  registerResourcePolicy(roleChangeRequestPolicy);
  registerResourcePolicy(approvalDelegationPolicy);
}

const approvalDelegationPolicy: ResourcePolicy = {
  resourceType: 'approvalDelegation',

  domain: 'business',

  async check(ctx, _action, resource, scope) {
    switch (scope) {
      case 'own':
        return resource['delegatorUserId'] === ctx.principal.id;

      case 'participant':
        return (
          resource['delegatorUserId'] === ctx.principal.id ||
          resource['delegateUserId'] === ctx.principal.id
        );

      default:
        return false;
    }
  },

  async filter(ctx, _action, scope) {
    switch (scope) {
      case 'own':
        return {
          sql: 'approval_delegation.delegator_user_id = $1',
          parameters: [ctx.principal.id],
        };

      case 'participant':
        return {
          sql: '(approval_delegation.delegator_user_id = $1 OR approval_delegation.delegate_user_id = $1)',
          parameters: [ctx.principal.id],
        };

      default:
        return MATCH_NOTHING;
    }
  },

  participantFields() {
    return ['delegatorUserId', 'delegateUserId'];
  },

  initiatorField() {
    return null;
  },
};