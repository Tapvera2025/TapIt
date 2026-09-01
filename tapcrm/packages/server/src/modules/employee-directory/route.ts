import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { route } from '../../platform/http/route.js';
import { pagination } from '../../platform/http/envelope.js';
import { RequestValidationError } from '../../platform/http/auth-error.js';
import { sql } from '../../platform/dal/sql.js';
import { db } from '../../platform/dal/db.js';
import type { Resource } from '@tapcrm/authz';
import {
  createEmployee,
  getEmployee,
  listEmployees,
  patchEmployee,
  changeEmploymentStatus,
} from './service.js';

const employeeId = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  .transform((v) => v.toUpperCase());
const date = z.string().date();
const base = z.object({
  employeeId,
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(320),
  contact: z
    .string()
    .trim()
    .min(7)
    .max(30)
    .regex(/^[+0-9()\-\s]+$/)
    .optional(),
  dateOfBirth: date.optional(),
  gender: z.enum(['male', 'female', 'non-binary', 'prefer-not-to-say']).optional(),
  employmentType: z
    .enum(['full-time', 'part-time', 'contract', 'intern', 'temporary'])
    .default('full-time'),
  joiningDate: date,
  departmentId: z.string().uuid(),
  positionId: z.string().uuid(),
  teamId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  specialization: z.string().trim().max(200).nullable().optional(),
  reportsTo: z.string().uuid().nullable().optional(),
});
const createSchema = base;
const patchSchema = z
  .object({
    fullName: z.string().trim().min(2).max(200).optional(),
    contact: z
      .string()
      .trim()
      .min(7)
      .max(30)
      .regex(/^[+0-9()\-\s]+$/)
      .nullable()
      .optional(),
    dateOfBirth: date.nullable().optional(),
    gender: z
      .enum(['male', 'female', 'non-binary', 'prefer-not-to-say'])
      .nullable()
      .optional(),
    employmentType: z
      .enum(['full-time', 'part-time', 'contract', 'intern', 'temporary'])
      .optional(),
    joiningDate: date.optional(),
    teamId: z.string().uuid().nullable().optional(),
    designationId: z.string().uuid().nullable().optional(),
    specialization: z.string().trim().max(200).nullable().optional(),
    reportsTo: z.string().uuid().nullable().optional(),
    departmentId: z.string().uuid().optional(),
    positionId: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided.');
const statusSchema = z.object({
  status: z.enum(['active', 'on-notice', 'inactive', 'terminated', 'absconded']),
});
function parse<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  body: unknown,
): z.output<TSchema> {
  const p = schema.safeParse(body);
  if (!p.success) throw new RequestValidationError(p.error.issues);
  return p.data;
}

/**
 * Loads one employee for the object-level check (AZ-1).
 *
 * Selects every field `UserPolicy` reads. The previous version fetched only id,
 * account type, name and email, so `resource.departmentId` was always
 * undefined and the department-scope check could never pass — which fails
 * closed, but leaves the endpoint dead for everyone below Super Admin and looks
 * like a permissions problem rather than a missing column.
 */
async function loadUser(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<Record<string, unknown>>(
    ctx,
    sql`
      SELECT id, organization_id, account_type, department_id, team_id, reports_to,
             position_id, full_name, email, status
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND id = ${id}
        AND account_type = 'employee'
      LIMIT 1
    `,
  );
  return row === null ? null : { ...row, type: 'user', id };
}

export function registerEmployeeDirectoryRoutes(): void {
  route({
    method: 'GET',
    path: '/api/users',
    action: 'users:view',
    // AZ-2 — the scope predicate goes into the WHERE clause, in the service.
    collection: true,
    handler: async ({ ctx, query }) => listEmployees(ctx, pagination(query)),
  });

  route({
    method: 'GET',
    path: '/api/users/:id',
    action: 'users:view',
    resourceParam: 'id',
    loadResource: loadUser,
    handler: async ({ ctx, params }) => getEmployee(ctx, params['id'] ?? ''),
  });

  route({
    method: 'POST',
    path: '/api/users',
    action: 'users:manage',
    creates: true,
    handler: async ({ ctx, body }) => createEmployee(ctx, parse(createSchema, body)),
  });

  route({
    method: 'PATCH',
    path: '/api/users/:id',
    action: 'users:manage',
    resourceParam: 'id',
    loadResource: loadUser,
    handler: async ({ ctx, params, body }) =>
      patchEmployee(ctx, params['id'] ?? '', parse(patchSchema, body)),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/status',
    action: 'users:manage',
    resourceParam: 'id',
    loadResource: loadUser,
    handler: async ({ ctx, params, body }) =>
      changeEmploymentStatus(ctx, params['id'] ?? '', parse(statusSchema, body).status),
  });
}
