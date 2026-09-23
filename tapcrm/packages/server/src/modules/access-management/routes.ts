import { route } from '../../platform/http/route.js';
import { userResource } from '../identity/security/unlock.js';
import { z } from 'zod';
import { loadOverrideResource, loadRoleChangeResource } from './repository.js';
import {
  decideRoleChange,
  getDelegationOptions,
  getCapabilityHolders,
  getEffectiveAccess,
  getOverrideOverview,
  getRoleChangeRequestAccess,
  getRoleChangeRequests,
  grantOverride,
  requestRoleChange,
  revokeOverride,
} from './service.js';

const scopeSchema = z.enum(['own', 'participant', 'pool', 'team', 'department', 'all-people']);
const overrideSchema = z.object({
  userId: z.string().uuid(),
  action: z.string().min(1),
  allowed: z.boolean(),
  scope: scopeSchema,
  fields: z.array(z.string().min(1)).nullable().optional().transform((value) => value ?? null),
  reason: z.string(),
  expiresAt: z
    .union([z.string().datetime({ offset: true }).transform((value) => new Date(value)), z.null()])
    .optional()
    .transform((value) => value ?? null),
});
const roleChangeRequestSchema = z.object({
  subjectUserId: z.string().uuid(),
  toPositionId: z.string().uuid(),
  requestedReportsTo: z.string().uuid().nullable().optional().transform((value) => value ?? null),
  reason: z.string(),
});
const roleChangeDecisionSchema = z.object({ approved: z.boolean(), reason: z.string() });

/** AM-4/AM-5. The router performs access:view before these handlers run. */
export function registerAccessManagementRoutes(): void {
  route({
    method: 'GET',
    path: '/api/access/effective/:userId',
    action: 'access:view',
    module: 'access-management',
    resourceParam: 'userId',
    loadResource: userResource,
    handler: async ({ ctx, params }) => getEffectiveAccess(ctx, params['userId']!),
  });

  route({
    method: 'GET',
    path: '/api/access/who-can/:action',
    action: 'access:view',
    module: 'access-management',
    handler: async ({ ctx, params }) => {
      return getCapabilityHolders(ctx, params['action']!);
    },
  });

  route({
    method: 'GET',
    path: '/api/access/delegation-options/:userId',
    action: 'access:delegate',
    module: 'access-management',
    resourceParam: 'userId',
    loadResource: userResource,
    handler: async ({ ctx, params }) => getDelegationOptions(ctx, params['userId']!),
  });

  route({
    method: 'GET',
    path: '/api/access/overrides',
    action: 'access:view',
    module: 'access-management',
    handler: async ({ ctx }) => getOverrideOverview(ctx),
  });

  route({
    method: 'GET',
    path: '/api/access/role-change-request-access',
    action: 'access:request-role-change',
    module: 'access-management',
    handler: async () => getRoleChangeRequestAccess(),
  });

  route({
    method: 'GET',
    path: '/api/access/role-change-requests',
    // Listing is a collection read and has no request resource available for
    // the approval-bearing SoD check. The service still requires Super Admin;
    // the individual decision route below keeps access:decide-role-change.
    action: 'access:view',
    module: 'access-management',
    handler: async ({ ctx, query }) => {
      const status = z.enum(['pending', 'approved', 'rejected', 'all']).parse(query['status'] ?? 'pending');
      return getRoleChangeRequests(ctx, status);
    },
  });

  route({
    method: 'POST',
    path: '/api/access/override',
    action: 'access:delegate',
    module: 'access-management',
    status: 201,
    handler: async ({ ctx, body }) => grantOverride(ctx, overrideSchema.parse(body)),
  });

  route({
    method: 'DELETE',
    path: '/api/access/override/:id',
    action: 'access:delegate',
    module: 'access-management',
    resourceParam: 'id',
    loadResource: loadOverrideResource,
    handler: async ({ ctx, params }) => revokeOverride(ctx, params['id']!),
  });

  route({
    method: 'POST',
    path: '/api/access/role-change-request',
    action: 'access:request-role-change',
    module: 'access-management',
    status: 201,
    handler: async ({ ctx, body }) => requestRoleChange(ctx, roleChangeRequestSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/access/role-change-request/:id/decide',
    action: 'access:decide-role-change',
    module: 'access-management',
    resourceParam: 'id',
    loadResource: loadRoleChangeResource,
    handler: async ({ ctx, params, body }) =>
      decideRoleChange(ctx, params['id']!, roleChangeDecisionSchema.parse(body)),
  });
}
