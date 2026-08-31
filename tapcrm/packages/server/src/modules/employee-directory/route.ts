import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { route } from '../../platform/http/route.js';
import { RequestValidationError } from '../../platform/http/auth-error.js';
import { sql } from '../../platform/dal/sql.js';
import { db } from '../../platform/dal/db.js';
import { visibilityFilter, type Resource } from '@tapcrm/authz';
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

async function loadUser(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne(
    ctx,
    sql`SELECT id,organization_id,account_type,full_name,email FROM app_user WHERE organization_id=${ctx.organizationId} AND id=${id} AND account_type='employee' LIMIT 1`,
  );
  return row ? { ...row, type: 'user', id } : null;
}

export function registerEmployeeDirectoryRoutes(): void {
  route({
    method: 'GET',
    path: '/api/users',
    action: 'users:view',
    handler: async ({ ctx }) => {
      const filter = await visibilityFilter(ctx, 'users:view', 'user');
      const rows = await listEmployees(ctx);
      // The service query is tenant-scoped; apply the authorization visibility
      // predicate again to the actual user ids before returning them.
      const allowed = await db.query<{ id: string }>(
        ctx,
        sql`SELECT id FROM app_user WHERE organization_id=${ctx.organizationId} AND account_type='employee' AND ${filter}`,
      );
      const ids = new Set(allowed.map((x) => x.id));
      return rows.filter((r) => ids.has(String((r as Record<string, unknown>)['id'])));
    },
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
