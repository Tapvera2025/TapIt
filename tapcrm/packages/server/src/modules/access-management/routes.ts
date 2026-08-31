import { route } from '../../platform/http/route.js';

import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

import type { RequestContext } from '../../platform/dal/context.js';
import type { Resource } from '@tapcrm/authz';

import { RequestValidationError } from '../../platform/http/auth-error.js';

import {
  createOverrideSchema,
  roleChangeRequestSchema,
  decideRoleChangeSchema,
  createApprovalDelegationSchema,
  revokeApprovalDelegationSchema,
} from './validation.js';

import {
  getEffectivePoliciesForUser,
  getWhoCanPerformAction,
  listUserOverrides,
  createUserOverride,
  revokeUserOverride,
  listRoleChangeRequests,
  createRoleChangeRequest,
  decideRoleChangeRequest,
  listTenantUsers,
  listTenantPositions,
  listRegistryActions,
  getMyPermissions,
  listApprovalDelegations,
  createApprovalDelegation,
  revokeApprovalDelegation,
} from './service.js';

/* ================================================================== *
 * Resource Loader
 * ================================================================== */

async function loadAccessResource(
  ctx: RequestContext,
  table: 'app_user' | 'user_override' | 'role_change_request' | 'approval_delegation',
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<Record<string, unknown>>(
    ctx,
    sql`
        SELECT *
        FROM ${sql.raw(table)}
        WHERE id = ${id}
          AND organization_id = ${ctx.organizationId}
      `,
  );

  if (!row) {
    return null;
  }

  const targetUserId = typeof row['user_id'] === 'string' ? row['user_id'] : id;

  let type: string;

  switch (table) {
    case 'app_user':
    case 'user_override':
      type = 'user';
      break;

    case 'role_change_request':
      type = 'roleChangeRequest';
      break;

    case 'approval_delegation':
      type = 'approvalDelegation';
      break;
  }

  return {
    ...row,
    type,
    id: table === 'user_override' ? targetUserId : id,
  };
}

export function registerAccessRoutes(): void {
  /* ================================================================== *
   * Current User Permissions
   *
   * AUTHORIZATION.md §8
   *
   * This is intentionally authOnly:
   * the user is reading their own permission projection.
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/me/permissions',
    authOnly: true,

    async handler({ ctx }) {
      return getMyPermissions(ctx);
    },
  });

  /* ================================================================== *
   * Access Explorer
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/access/effective/:userId',

    action: 'access:view',

    resourceParam: 'userId',

    loadResource: (ctx, id) => loadAccessResource(ctx, 'app_user', id),

    async handler({ ctx, params }) {
      const userId = params['userId']!;

      return getEffectivePoliciesForUser(ctx, userId);
    },
  });

  route({
    method: 'GET',
    path: '/api/access/who-can/:action',

    action: 'access:view',

    async handler({ ctx, params }) {
      const action = params['action']!;

      return {
        action,
        holders: await getWhoCanPerformAction(ctx, action),
      };
    },
  });

  /* ================================================================== *
   * Tenant users / positions
   *
   * Kept as authenticated helpers.
   * UI should still rely on authorization for mutation.
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/access/users',
    authOnly: true,

    async handler({ ctx }) {
      return listTenantUsers(ctx);
    },
  });

  route({
    method: 'GET',
    path: '/api/access/positions',
    authOnly: true,

    async handler({ ctx }) {
      return listTenantPositions(ctx);
    },
  });

  /* ================================================================== *
   * Overrides
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/access/overrides',
    authOnly: true,

    async handler({ ctx }) {
      return listUserOverrides(ctx);
    },
  });

  route({
    method: 'POST',
    path: '/api/access/override',

    action: 'access:delegate',

    status: 201,

    async handler({ ctx, body }) {
      const parsed = createOverrideSchema.safeParse(body);

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      return createUserOverride(ctx, parsed.data);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/access/override/:id',

    action: 'access:delegate',

    resourceParam: 'id',

    loadResource: (ctx, id) => loadAccessResource(ctx, 'user_override', id),

    async handler({ ctx, params }) {
      await revokeUserOverride(ctx, params['id']!);

      return {
        message: 'Override revoked successfully.',
      };
    },
  });

  /* ================================================================== *
   * Role Change
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/access/role-change-requests',
    authOnly: true,

    async handler({ ctx }) {
      return listRoleChangeRequests(ctx);
    },
  });

  route({
    method: 'POST',
    path: '/api/access/role-change-request',

    action: 'access:request-role-change',

    status: 201,

    async handler({ ctx, body }) {
      const parsed = roleChangeRequestSchema.safeParse(body);

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      return createRoleChangeRequest(ctx, parsed.data);
    },
  });

  route({
    method: 'POST',
    path: '/api/access/role-change-request/:id/decide',

    action: 'access:decide-role-change',

    resourceParam: 'id',

    loadResource: (ctx, id) => loadAccessResource(ctx, 'role_change_request', id),

    async handler({ ctx, params, body }) {
      const parsed = decideRoleChangeSchema.safeParse(body);

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await decideRoleChangeRequest(ctx, params['id']!, parsed.data);

      return {
        message: `Role change request ${parsed.data.status} successfully.`,
      };
    },
  });

  /* ================================================================== *
   * Registry
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/access/registry-actions',
    authOnly: true,

    async handler() {
      return listRegistryActions();
    },
  });

  /* ================================================================== *
   * Approval Delegation
   *
   * Manifest:
   *
   * GET    /api/approvals/delegations
   * POST   /api/approvals/delegations
   * DELETE /api/approvals/delegations/:id
   * ================================================================== */

  route({
    method: 'GET',
    path: '/api/approvals/delegations',

    action: 'approvals:delegate',

    async handler({ ctx }) {
      return listApprovalDelegations(ctx);
    },
  });

  route({
    method: 'POST',
    path: '/api/approvals/delegations',

    action: 'approvals:delegate',

    status: 201,

    async handler({ ctx, body }) {
      const parsed = createApprovalDelegationSchema.safeParse(body);

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      return createApprovalDelegation(ctx, parsed.data);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/approvals/delegations/:id',

    action: 'approvals:delegate',

    resourceParam: 'id',

    loadResource: (ctx, id) => loadAccessResource(ctx, 'approval_delegation', id),

    async handler({ ctx, params, body }) {
      const parsed = revokeApprovalDelegationSchema.safeParse(body ?? {});

      if (!parsed.success) {
        throw new RequestValidationError(parsed.error.issues);
      }

      await revokeApprovalDelegation(ctx, params['id']!, parsed.data.reason);

      return {
        message: 'Approval delegation revoked successfully.',
      };
    },
  });
}
