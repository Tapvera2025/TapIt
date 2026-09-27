import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import { makeLeaveTypeResource, makeLeaveRequestResource } from './policy.js';
import { createLeaveType, listLeaveTypes, updateLeaveType, cancelLeave, getBalances, getLeaveCalendar, getLeaveRequest, listLeaveRequests, submitLeave, submitWfh, submitStandingWfh, acknowledgeLeave, decideLeave } from './service.js';
import { createLeaveTypeSchema, updateLeaveTypeSchema, balanceQuerySchema, calendarQuerySchema, listQuerySchema, submitLeaveSchema, submitWfhSchema, submitStandingWfhSchema, decideSchema } from './validators.js';

async function loadLeaveType(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx, sql`SELECT id, organization_id AS "organizationId" FROM leave_type WHERE id = ${id}`,
  );
  return row ? makeLeaveTypeResource(row.id, row.organizationId) : null;
}

export function registerLeaveRoutes(): void {
  route({ method: 'GET',  path: '/api/leaves/types', action: 'leave:manage-types', module: 'leave',
    handler: async ({ ctx }) => listLeaveTypes(ctx) });
  route({ method: 'POST', path: '/api/leaves/types', action: 'leave:manage-types', module: 'leave',
    handler: async ({ ctx, body }) => createLeaveType(ctx, createLeaveTypeSchema.parse(body)) });
  route({ method: 'PUT',  path: '/api/leaves/types/:id', action: 'leave:manage-types', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveType,
    handler: async ({ ctx, params, body }) => updateLeaveType(ctx, params['id']!, updateLeaveTypeSchema.parse(body)) });

  async function loadLeaveRequest(ctx: RequestContext, id: string): Promise<Resource | null> {
    const row = await db.maybeOne<{ id: string; organizationId: string; userId: string; requestedBy: string }>(
      ctx, sql`SELECT id, organization_id AS "organizationId",
               user_id AS "userId", requested_by AS "requestedBy"
               FROM leave_request WHERE id = ${id}`,
    );
    return row
      ? makeLeaveRequestResource(row.id, row.organizationId, row.userId, row.requestedBy)
      : null;
  }

  route({ method: 'GET', path: '/api/leaves', action: 'leave:view', module: 'leave',
    handler: async ({ ctx, query }) => listLeaveRequests(ctx, listQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/leaves/calendar', action: 'leave:view', module: 'leave',
    handler: async ({ ctx, query }) => getLeaveCalendar(ctx, calendarQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/leaves/balances/:userId', action: 'leave:view', module: 'leave',
    handler: async ({ ctx, params, query }) => getBalances(ctx, params['userId']!, balanceQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/leaves/:id', action: 'leave:view', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveRequest,
    handler: async ({ ctx, params }) => getLeaveRequest(ctx, params['id']!) });
  route({ method: 'POST', path: '/api/leaves', action: 'leave:request', module: 'leave',
    handler: async ({ ctx, body }) => submitLeave(ctx, submitLeaveSchema.parse(body)) });
  route({ method: 'DELETE', path: '/api/leaves/:id', action: 'leave:request', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveRequest,
    handler: async ({ ctx, params }) => cancelLeave(ctx, params['id']!) });
  route({ method: 'POST', path: '/api/leaves/wfh', action: 'leave:request-wfh', module: 'leave',
    handler: async ({ ctx, body }) => submitWfh(ctx, submitWfhSchema.parse(body)) });
  route({ method: 'POST', path: '/api/leaves/wfh/standing', action: 'leave:manage-wfh-standing', module: 'leave',
    handler: async ({ ctx, body }) => submitStandingWfh(ctx, submitStandingWfhSchema.parse(body)) });
  route({ method: 'DELETE', path: '/api/leaves/wfh/standing/:id', action: 'leave:manage-wfh-standing', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveRequest,
    handler: async ({ ctx, params }) => cancelLeave(ctx, params['id']!) });
  route({ method: 'POST', path: '/api/leaves/:id/acknowledge', action: 'leave:acknowledge', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveRequest,
    handler: async ({ ctx, params }) => acknowledgeLeave(ctx, params['id']!) });
  route({ method: 'POST', path: '/api/leaves/:id/decide', action: 'leave:decide', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveRequest,
    handler: async ({ ctx, params, body }) => decideLeave(ctx, params['id']!, decideSchema.parse(body)) });
}
