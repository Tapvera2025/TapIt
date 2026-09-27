import type { Action } from '@tapcrm/contracts';
import { MATCH_NOTHING, registerResourcePolicy, visibilityFilter, type ResourcePolicy } from '@tapcrm/authz';
import type { PolicyEvaluationContext } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export const makeLeaveTypeResource = (id: string, organizationId: string) =>
  ({ type: 'leaveType' as const, id, organizationId });

export const makeLeaveRequestResource = (
  id: string, organizationId: string, userId: string, requestedBy: string,
) => ({ type: 'leaveRequest' as const, id, organizationId, subjectId: userId, userId, requestedBy });

const leaveTypePolicy: ResourcePolicy = {
  resourceType: 'leaveType',
  domain: 'people',
  async check(ctx, _action, resource) {
    return resource['organizationId'] === ctx.organizationId;
  },
  filter: async (_ctx, _action, scope) => {
    if (scope === 'own' || scope === 'participant') return MATCH_NOTHING;
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: () => [],
  initiatorField: () => null,
};

const leaveRequestPolicy: ResourcePolicy = {
  resourceType: 'leaveRequest',
  domain: 'people',
  async check(ctx: PolicyEvaluationContext, action: Action, resource) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    const subjectId = resource['subjectId'] as string | undefined;
    if (!subjectId) return false;
    if (ctx.principal.id === subjectId) return true;

    const fragment = await visibilityFilter(ctx as unknown as RequestContext, action, 'leaveRequest');
    if (fragment === MATCH_NOTHING) return false;
    const row = await db.maybeOne<{ ok: boolean }>(
      ctx as unknown as RequestContext,
      sql`SELECT TRUE AS ok FROM (
        SELECT ${subjectId}::uuid AS user_id,
               NULL::uuid AS requested_by,
               NULL::uuid AS acknowledged_by,
               NULL::uuid AS decided_by
      ) t WHERE ${fragment}`,
    );
    return !!row?.ok;
  },
  async filter(ctx: PolicyEvaluationContext, _action: Action, scope: Scope) {
    if (scope === 'own') {
      return { sql: 'user_id = $1', parameters: [ctx.principal.id] };
    }
    if (scope === 'participant') {
      return {
        sql: 'requested_by = $1 OR acknowledged_by = $1 OR decided_by = $1',
        parameters: [ctx.principal.id],
      };
    }
    if (scope === 'department') {
      const deptId = await ctx.scope.departmentId(ctx);
      if (!deptId) return MATCH_NOTHING;
      return {
        sql: 'user_id IN (SELECT id FROM app_user WHERE department_id = $1)',
        parameters: [deptId],
      };
    }
    if (scope === 'team') {
      const teamIds = await ctx.scope.teamIds(ctx);
      if (teamIds.size === 0) return MATCH_NOTHING;
      return {
        sql: 'user_id IN (SELECT user_id FROM team_member WHERE team_id = ANY($1::uuid[]))',
        parameters: [[...teamIds]],
      };
    }
    if (scope === 'pool') {
      const memberIds = await ctx.scope.poolMemberIds(ctx);
      if (memberIds.size === 0) return MATCH_NOTHING;
      return { sql: 'user_id = ANY($1::uuid[])', parameters: [[...memberIds]] };
    }
    return { sql: 'TRUE', parameters: [] };
  },
  participantFields: (action) =>
    action === 'leave:acknowledge' || action === 'leave:decide' ? ['requestedBy'] : [],
  initiatorField: (action) =>
    action === 'leave:acknowledge' || action === 'leave:decide' ? 'requestedBy' : null,
};

export function registerLeavePolicies(): void {
  registerResourcePolicy(leaveTypePolicy);
  registerResourcePolicy(leaveRequestPolicy);
}

export async function loadLeaveAttachmentResource(
  ctx: RequestContext,
  attachmentId: string,
): Promise<Record<string, unknown> | null> {
  const row = await db.maybeOne<{
    id: string; organizationId: string; userId: string; departmentCode: string | null;
  }>(ctx, sql`
    SELECT la.id, la.organization_id AS "organizationId", la.user_id AS "userId",
           d.code AS "departmentCode"
    FROM leave_attachment la
    JOIN app_user u ON u.id = la.user_id AND u.organization_id = la.organization_id
    LEFT JOIN department d ON d.id = u.department_id AND d.organization_id = la.organization_id
    WHERE la.id = ${attachmentId}
  `);
  if (!row) return null;
  return {
    type: 'leave_attachment', id: row.id, organizationId: row.organizationId,
    subjectId: row.userId,
    __holderIsHr: row.departmentCode?.toUpperCase() === 'HR',
  };
}
