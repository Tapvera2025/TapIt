import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
  type SqlFragment,
} from '@tapcrm/authz';
import type { Action, Scope } from '@tapcrm/contracts';

/**
 * Task resource policy.
 *
 * Implements object-level checks and list visibility filters across scopes:
 * - own / participant: Creator or assigned user
 * - team: User's team members
 * - department: User's department members
 * - pool: User's sales pool members
 *
 * NOTE: Handlers do not call authorize() directly; authorization is evaluated
 * upstream by the HTTP router middleware before handlers are reached.
 */
export const taskPolicy: ResourcePolicy = {
  resourceType: 'task',
  domain: 'business',

  async check(
    ctx: PolicyEvaluationContext,
    _action: Action,
    resource: Resource,
    scope: Scope,
  ): Promise<boolean> {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return false; // PD-1: not allowed for business domain

    const isCreator = resource['createdBy'] === ctx.principal.id;
    const isAssigned =
      resource['assignedTo'] === ctx.principal.id ||
      (Array.isArray(resource['assigneeIds']) &&
        resource['assigneeIds'].includes(ctx.principal.id));

    // Conceptual access model: user is creator OR user is eligible assignee/participant OR user has authorized scope
    if (_action === 'tasks:view' && (isCreator || isAssigned)) {
      return true;
    }

    if (scope === 'own' || scope === 'participant') {
      return isCreator || isAssigned;
    }

    if (scope === 'team') {
      const allowedTeamIds = await ctx.scope.teamIds(ctx);
      if (allowedTeamIds.size === 0) return false;

      const taskTeamIds = new Set<string>();

      if (typeof resource['teamId'] === 'string' && resource['teamId'].length > 0) {
        taskTeamIds.add(resource['teamId']);
      }

      if (Array.isArray(resource['teamIds'])) {
        for (const tid of resource['teamIds']) {
          if (typeof tid === 'string' && tid.length > 0) {
            taskTeamIds.add(tid);
          }
        }
      } else if (resource['teamIds'] instanceof Set) {
        for (const tid of resource['teamIds']) {
          if (typeof tid === 'string' && tid.length > 0) {
            taskTeamIds.add(tid);
          }
        }
      }

      if (typeof resource['creatorTeamId'] === 'string' && resource['creatorTeamId'].length > 0) {
        taskTeamIds.add(resource['creatorTeamId']);
      }

      if (Array.isArray(resource['assigneeTeamIds'])) {
        for (const tid of resource['assigneeTeamIds']) {
          if (typeof tid === 'string' && tid.length > 0) {
            taskTeamIds.add(tid);
          }
        }
      }

      if (Array.isArray(resource['assignees'])) {
        for (const assignee of resource['assignees']) {
          if (
            assignee &&
            typeof assignee === 'object' &&
            typeof (assignee as Record<string, unknown>)['teamId'] === 'string' &&
            ((assignee as Record<string, unknown>)['teamId'] as string).length > 0
          ) {
            taskTeamIds.add((assignee as Record<string, unknown>)['teamId'] as string);
          }
        }
      }

      // If no explicit team fields are on the resource, fall back to checking whether
      // the principal is creator or assignee and principal has a teamId
      if (taskTeamIds.size === 0) {
        const principalTeamId =
          ctx.principal.accountType === 'employee' ? ctx.principal.teamId : null;
        if ((isCreator || isAssigned) && principalTeamId !== null && principalTeamId.length > 0) {
          taskTeamIds.add(principalTeamId);
        }
      }

      if (taskTeamIds.size === 0) {
        return false;
      }

      for (const tid of taskTeamIds) {
        if (allowedTeamIds.has(tid)) {
          return true;
        }
      }

      return false;
    }

    if (scope === 'department') {
      const allowedDepartmentId = await ctx.scope.departmentId(ctx);
      if (allowedDepartmentId === null) return false;

      const taskDepartmentIds = new Set<string>();

      if (
        typeof resource['departmentId'] === 'string' &&
        resource['departmentId'].length > 0
      ) {
        taskDepartmentIds.add(resource['departmentId']);
      }

      if (Array.isArray(resource['departmentIds'])) {
        for (const did of resource['departmentIds']) {
          if (typeof did === 'string' && did.length > 0) {
            taskDepartmentIds.add(did);
          }
        }
      } else if (resource['departmentIds'] instanceof Set) {
        for (const did of resource['departmentIds']) {
          if (typeof did === 'string' && did.length > 0) {
            taskDepartmentIds.add(did);
          }
        }
      }

      if (
        typeof resource['creatorDepartmentId'] === 'string' &&
        resource['creatorDepartmentId'].length > 0
      ) {
        taskDepartmentIds.add(resource['creatorDepartmentId']);
      }

      if (Array.isArray(resource['assigneeDepartmentIds'])) {
        for (const did of resource['assigneeDepartmentIds']) {
          if (typeof did === 'string' && did.length > 0) {
            taskDepartmentIds.add(did);
          }
        }
      }

      if (Array.isArray(resource['assignees'])) {
        for (const assignee of resource['assignees']) {
          if (
            assignee &&
            typeof assignee === 'object' &&
            typeof (assignee as Record<string, unknown>)['departmentId'] === 'string' &&
            ((assignee as Record<string, unknown>)['departmentId'] as string).length > 0
          ) {
            taskDepartmentIds.add(
              (assignee as Record<string, unknown>)['departmentId'] as string,
            );
          }
        }
      }

      // If no explicit department fields are on the resource, fall back to checking whether
      // the principal is creator or assignee and principal has a departmentId
      if (taskDepartmentIds.size === 0) {
        const principalDeptId =
          ctx.principal.accountType === 'employee'
            ? ctx.principal.departmentId
            : null;
        if (
          (isCreator || isAssigned) &&
          principalDeptId !== null &&
          principalDeptId.length > 0
        ) {
          taskDepartmentIds.add(principalDeptId);
        }
      }

      if (taskDepartmentIds.size === 0) {
        return false;
      }

      return taskDepartmentIds.has(allowedDepartmentId);
    }

    if (scope === 'pool') {
      const allowedPoolIds = await ctx.scope.poolIds(ctx);
      const allowedMemberIds = ctx.scope.poolMemberIds
        ? await ctx.scope.poolMemberIds(ctx)
        : new Set<string>();

      if (allowedPoolIds.size === 0 && allowedMemberIds.size === 0) {
        return false;
      }

      // 1. User / Owner match with allowedMemberIds
      if (allowedMemberIds.size > 0) {
        if (
          typeof resource['ownerId'] === 'string' &&
          allowedMemberIds.has(resource['ownerId'])
        ) {
          return true;
        }

        if (
          typeof resource['createdBy'] === 'string' &&
          allowedMemberIds.has(resource['createdBy'])
        ) {
          return true;
        }

        if (
          typeof resource['assignedTo'] === 'string' &&
          allowedMemberIds.has(resource['assignedTo'])
        ) {
          return true;
        }

        if (Array.isArray(resource['assigneeIds'])) {
          for (const uid of resource['assigneeIds']) {
            if (typeof uid === 'string' && allowedMemberIds.has(uid)) {
              return true;
            }
          }
        }

        if (Array.isArray(resource['assignees'])) {
          for (const a of resource['assignees']) {
            if (
              a &&
              typeof a === 'object' &&
              typeof (a as Record<string, unknown>)['id'] === 'string' &&
              allowedMemberIds.has((a as Record<string, unknown>)['id'] as string)
            ) {
              return true;
            }
          }
        }
      }

      // 2. Pool ID match with allowedPoolIds
      if (allowedPoolIds.size > 0) {
        const candidatePoolIds = new Set<string>();

        if (
          typeof resource['poolId'] === 'string' &&
          resource['poolId'].length > 0
        ) {
          candidatePoolIds.add(resource['poolId']);
        }

        if (
          typeof resource['teamId'] === 'string' &&
          resource['teamId'].length > 0
        ) {
          candidatePoolIds.add(resource['teamId']);
        }

        if (
          typeof resource['creatorTeamId'] === 'string' &&
          resource['creatorTeamId'].length > 0
        ) {
          candidatePoolIds.add(resource['creatorTeamId']);
        }

        if (Array.isArray(resource['poolIds'])) {
          for (const pid of resource['poolIds']) {
            if (typeof pid === 'string' && pid.length > 0) {
              candidatePoolIds.add(pid);
            }
          }
        } else if (resource['poolIds'] instanceof Set) {
          for (const pid of resource['poolIds']) {
            if (typeof pid === 'string' && pid.length > 0) {
              candidatePoolIds.add(pid);
            }
          }
        }

        if (Array.isArray(resource['teamIds'])) {
          for (const tid of resource['teamIds']) {
            if (typeof tid === 'string' && tid.length > 0) {
              candidatePoolIds.add(tid);
            }
          }
        } else if (resource['teamIds'] instanceof Set) {
          for (const tid of resource['teamIds']) {
            if (typeof tid === 'string' && tid.length > 0) {
              candidatePoolIds.add(tid);
            }
          }
        }

        if (Array.isArray(resource['assigneeTeamIds'])) {
          for (const tid of resource['assigneeTeamIds']) {
            if (typeof tid === 'string' && tid.length > 0) {
              candidatePoolIds.add(tid);
            }
          }
        }

        if (Array.isArray(resource['assignees'])) {
          for (const a of resource['assignees']) {
            if (
              a &&
              typeof a === 'object' &&
              typeof (a as Record<string, unknown>)['teamId'] === 'string' &&
              ((a as Record<string, unknown>)['teamId'] as string).length > 0
            ) {
              candidatePoolIds.add(
                (a as Record<string, unknown>)['teamId'] as string,
              );
            }
          }
        }

        for (const pid of candidatePoolIds) {
          if (allowedPoolIds.has(pid)) {
            return true;
          }
        }
      }

      // 3. Fallback: If caller is creator or assignee, check if caller is in the pool
      if (isCreator || isAssigned) {
        if (allowedMemberIds.has(ctx.principal.id)) {
          return true;
        }
        if (
          ctx.principal.accountType === 'employee' &&
          ctx.principal.teamId &&
          allowedPoolIds.has(ctx.principal.teamId)
        ) {
          return true;
        }
      }

      return false;
    }

    return false;
  },

  async filter(
    ctx: PolicyEvaluationContext,
    _action: Action,
    scope: Scope,
  ): Promise<SqlFragment> {
    if (scope === 'all-people') return MATCH_NOTHING;

    if (scope === 'own' || scope === 'participant') {
      return {
        sql: '(t.created_by = $1 OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.id AND ta.user_id = $1))',
        parameters: [ctx.principal.id],
      };
    }

    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (deptId === null) return MATCH_NOTHING;
      return {
        sql: '(EXISTS (SELECT 1 FROM app_user u WHERE u.id = t.created_by AND u.department_id = $1) OR EXISTS (SELECT 1 FROM task_assignee ta JOIN app_user u ON u.id = ta.user_id WHERE ta.task_id = t.id AND u.department_id = $1))',
        parameters: [deptId],
      };
    }

    if (scope === 'team') {
      const teams = [...(await ctx.scope.teamIds(ctx))];
      if (teams.length === 0) return MATCH_NOTHING;
      return {
        sql: '(EXISTS (SELECT 1 FROM app_user u WHERE u.id = t.created_by AND u.team_id = ANY($1::uuid[])) OR EXISTS (SELECT 1 FROM task_assignee ta JOIN app_user u ON u.id = ta.user_id WHERE ta.task_id = t.id AND u.team_id = ANY($1::uuid[])))',
        parameters: [teams],
      };
    }

    if (scope === 'pool') {
      const allowedPoolIds = await ctx.scope.poolIds(ctx);
      const allowedMemberIds = ctx.scope.poolMemberIds
        ? await ctx.scope.poolMemberIds(ctx)
        : new Set<string>();

      const pools = [...allowedPoolIds];
      const members = [...allowedMemberIds];

      if (pools.length === 0 && members.length === 0) {
        return MATCH_NOTHING;
      }

      if (pools.length > 0 && members.length > 0) {
        return {
          sql: '(t.created_by = ANY($1::uuid[]) OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.id AND ta.user_id = ANY($1::uuid[])) OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = t.created_by AND u.team_id = ANY($2::uuid[])) OR EXISTS (SELECT 1 FROM task_assignee ta JOIN app_user u ON u.id = ta.user_id WHERE ta.task_id = t.id AND u.team_id = ANY($2::uuid[])))',
          parameters: [members, pools],
        };
      }

      if (members.length > 0) {
        return {
          sql: '(t.created_by = ANY($1::uuid[]) OR EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.id AND ta.user_id = ANY($1::uuid[])))',
          parameters: [members],
        };
      }

      return {
        sql: '(EXISTS (SELECT 1 FROM app_user u WHERE u.id = t.created_by AND u.team_id = ANY($1::uuid[])) OR EXISTS (SELECT 1 FROM task_assignee ta JOIN app_user u ON u.id = ta.user_id WHERE ta.task_id = t.id AND u.team_id = ANY($1::uuid[])))',
        parameters: [pools],
      };
    }

    return MATCH_NOTHING;
  },

  participantFields() {
    return ['assignedTo', 'createdBy'];
  },

  initiatorField(action: Action) {
    return action === 'tasks:review' ? 'assignedTo' : null;
  },
};

export function registerTasksPolicies(): void {
  registerResourcePolicy(taskPolicy);
}
