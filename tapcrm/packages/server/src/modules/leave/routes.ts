import type { Resource } from '@tapcrm/authz';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import { makeLeaveTypeResource } from './policy.js';
import { createLeaveType, listLeaveTypes, updateLeaveType } from './service.js';
import { createLeaveTypeSchema, updateLeaveTypeSchema } from './validators.js';

async function loadLeaveType(ctx: any, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx, sql`SELECT id, organization_id AS "organizationId" FROM leave_type WHERE id = ${id}`,
  );
  return row ? makeLeaveTypeResource(row.id, row.organizationId) as unknown as Resource : null;
}

export function registerLeaveRoutes(): void {
  route({ method: 'GET',  path: '/api/leaves/types', action: 'leave:manage-types', module: 'leave',
    handler: async ({ ctx }) => listLeaveTypes(ctx) });
  route({ method: 'POST', path: '/api/leaves/types', action: 'leave:manage-types', module: 'leave',
    handler: async ({ ctx, body }) => createLeaveType(ctx, createLeaveTypeSchema.parse(body)) });
  route({ method: 'PUT',  path: '/api/leaves/types/:id', action: 'leave:manage-types', module: 'leave',
    resourceParam: 'id', loadResource: loadLeaveType,
    handler: async ({ ctx, params, body }) => updateLeaveType(ctx, params['id']!, updateLeaveTypeSchema.parse(body)) });
}
