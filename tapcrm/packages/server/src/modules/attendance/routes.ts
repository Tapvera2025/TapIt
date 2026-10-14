import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import { organizationToday } from '../../platform/organization-time.js';
import {
  approveCorrection,
  bulkCorrection,
  listCorrections,
  raiseCorrection,
  rejectCorrection,
  requestCorrection,
} from './correction.js';
import { directRangeExport, getExportStatus } from './export.js';
import { dayDetail, listRecords } from './service.js';
import { registerAttendanceReportingRoutes } from './reporting/routes.js';
import {
  approveSchema,
  bulkCorrectionSchema,
  dateSchema,
  exportSchema,
  listQuerySchema,
  raiseCorrectionSchema,
  requestCorrectionSchema,
  rejectSchema,
  correctionListQuerySchema,
} from './validators.js';

/**
 * The attendance API (§8.7), as the registry binds it.
 *
 * The day detail's loader is subject-keyed: the router passes it only the
 * `userId` the binding names, so it loads the PERSON as an `attendanceRecord`
 * resource — `{ type, id: userId, userId, departmentId, teamId,
 * organizationId }` — and the policy checks the caller's scope against that
 * person's placement. The handler then reads the date.
 */
export async function loadAttendanceSubject(
  ctx: RequestContext,
  userId: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'attendanceRecord' AS type, id, id AS "userId", organization_id AS "organizationId",
           department_id AS "departmentId", team_id AS "teamId"
    FROM app_user WHERE id = ${userId} AND account_type = 'employee'
    `,
  );
}

// The loader supplies both A1's initiator and P9's organization-local date.
async function loadCorrectionResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<Resource>(sql`
      SELECT 'attendanceCorrection' AS type, c.id, c.user_id AS "userId",
             c.organization_id AS "organizationId", c.work_date::text AS "workDate",
             c.requested_by AS "requestedBy",
             u.department_id AS "departmentId", u.team_id AS "teamId"
      FROM attendance_correction c
      JOIN app_user u ON u.id = c.user_id AND u.organization_id = c.organization_id
      WHERE c.id = ${id}
    `);
    return row === null ? null : { ...row, organizationToday: await organizationToday(tx) };
  });
}

export function registerAttendanceRoutes(): void {
  registerAttendanceReportingRoutes();
  // /corrections/request and /corrections/bulk must be registered before /corrections/:id
  // to avoid the literal path segments matching `:id`.
  route({
    method: 'POST', path: '/api/attendance/corrections/request',
    action: 'attendance:request-correction', module: 'attendance', status: 201,
    handler: async ({ ctx, body }) => requestCorrection(ctx, requestCorrectionSchema.parse(body)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections/bulk',
    action: 'attendance:raise-correction', module: 'attendance', status: 201,
    handler: async ({ ctx, body }) => bulkCorrection(ctx, bulkCorrectionSchema.parse(body)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections',
    action: 'attendance:raise-correction', module: 'attendance', status: 201,
    handler: async ({ ctx, body }) => raiseCorrection(ctx, raiseCorrectionSchema.parse(body)),
  });

  route({
    method: 'GET', path: '/api/attendance/corrections',
    action: 'attendance:view', module: 'attendance',
    handler: async ({ ctx, query }) => listCorrections(ctx, correctionListQuerySchema.parse(query)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections/:id/reject',
    action: 'attendance:correct', module: 'attendance', status: 200,
    resourceParam: 'id', loadResource: loadCorrectionResource,
    handler: async ({ ctx, params, body }) =>
      rejectCorrection(ctx, params['id']!, rejectSchema.parse(body)),
  });

  route({
    method: 'POST', path: '/api/attendance/corrections/:id/approve',
    action: 'attendance:correct', module: 'attendance',
    resourceParam: 'id', loadResource: loadCorrectionResource,
    handler: async ({ ctx, params, body }) =>
      approveCorrection(ctx, params['id']!, approveSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/attendance',
    action: 'attendance:view',
    module: 'attendance',
    handler: async ({ ctx, query }) => listRecords(ctx, listQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/attendance/export',
    action: 'attendance:export',
    module: 'attendance',
    // Accepted: the file does not exist yet. The body says where to ask for it.
    handler: async ({ ctx, body, res }) => {
      const file = await directRangeExport(ctx, exportSchema.parse(body));
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });

  route({
    method: 'GET',
    path: '/api/attendance/exports/:jobId',
    action: 'attendance:export',
    module: 'attendance',
    // No resource loader: an export spans many people, so no one subject
    // authorizes it. It belongs to whoever asked for it (checked inside).
    handler: async ({ ctx, params }) => getExportStatus(ctx, params['jobId']!),
  });

  // Registered last: `/:userId/:date` would otherwise shadow `/exports/:jobId`
  // (routes match in registration order).
  route({
    method: 'GET',
    path: '/api/attendance/:userId/:date',
    action: 'attendance:view',
    module: 'attendance',
    resourceParam: 'userId',
    loadResource: loadAttendanceSubject,
    handler: async ({ ctx, params }) =>
      dayDetail(ctx, params['userId']!, dateSchema.parse(params['date'])),
  });
}
