import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import { z } from 'zod';
import {
  assign,
  createWeekdaySchedule,
  createWorkingDayException,
  getEmployeeWeekdaySchedule,
  createShift,
  decideRequest,
  explainShifts,
  listWeekdaySchedules,
  listWorkingDayExceptions,
  listShiftTemplates,
  reviseShift,
  updateWeekdaySchedule,
  updateWorkingDayException,
} from './service.js';
import {
  assignmentSchema,
  createShiftSchema,
  decideSchema,
  explainQuerySchema,
  reviseShiftSchema,
  createWeekdayScheduleSchema,
  updateWeekdayScheduleSchema,
  createWorkingDayExceptionSchema,
  updateWorkingDayExceptionSchema,
  workingDayExceptionListQuerySchema,
} from './validators.js';

/** Design §6.4 — the six bindings AUTHORIZATION.md §6.5 lists. Raising and listing requests wait for G3. */

async function loadShift(ctx: RequestContext, id: string): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'shift' AS type, id, organization_id AS "organizationId" FROM shift WHERE id = ${id}
  `,
  );
}

async function loadShiftRequest(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'shiftRequest' AS type, r.id, r.organization_id AS "organizationId", r.user_id AS "userId",
           u.team_id AS "teamId", u.department_id AS "departmentId",
           r.requested_by AS "requestedBy", r.status
    FROM shift_request r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    WHERE r.id = ${id}
  `,
  );
}

export function registerShiftRoutes(): void {
  route({
    method: 'GET',
    path: '/api/shifts',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx }) => listShiftTemplates(ctx),
  });

  route({
    method: 'POST',
    path: '/api/shifts',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) => createShift(ctx, createShiftSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/shifts/weekday-schedules',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx }) => listWeekdaySchedules(ctx),
  });

  route({
    method: 'GET',
    path: '/api/shifts/weekday-schedules/assignments',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx, query }) =>
      getEmployeeWeekdaySchedule(ctx, z.string().uuid().parse(query['userId'])),
  });

  route({
    method: 'POST',
    path: '/api/shifts/weekday-schedules',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) =>
      createWeekdaySchedule(ctx, createWeekdayScheduleSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/shifts/weekday-schedules/exceptions',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx, query }) =>
      listWorkingDayExceptions(ctx, workingDayExceptionListQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/weekday-schedules/exceptions',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) =>
      createWorkingDayException(ctx, createWorkingDayExceptionSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/shifts/weekday-schedules/exceptions/:id',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, params, body }) =>
      updateWorkingDayException(
        ctx,
        params['id']!,
        updateWorkingDayExceptionSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/shifts/weekday-schedules/:id',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, params, body }) =>
      updateWeekdaySchedule(
        ctx,
        params['id']!,
        updateWeekdayScheduleSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/shifts/:id',
    action: 'shifts:manage',
    module: 'shifts',
    resourceParam: 'id',
    loadResource: loadShift,
    handler: async ({ ctx, params, body }) =>
      reviseShift(ctx, params['id']!, reviseShiftSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/shifts/assignments',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx, query }) =>
      explainShifts(ctx, explainQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/assignments',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) => assign(ctx, assignmentSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/requests/:id/decide',
    action: 'shifts:approve',
    module: 'shifts',
    resourceParam: 'id',
    loadResource: loadShiftRequest,
    status: 200,
    handler: async ({ ctx, params, body }) =>
      decideRequest(ctx, params['id']!, decideSchema.parse(body)),
  });
}
