import type { Router } from 'express';
import { acceptAdminInvitation } from './invitations.js';
import { setupEmployeePassword, verifyEmployeeSetupToken } from './setup.js';
import { installPrincipalResolver } from '../../platform/http/context.js';
import { installSocketPrincipalResolver } from '../../platform/realtime/server.js';
import { resolvePrincipal, resolvePrincipalFromToken } from './service.js';
import {
  loginController,
  refreshController,
  logoutController,
  listSessionsController,
  revokeSessionController,
  revokeAllSessionsController,
  changeTemporaryPasswordController,
} from './controller.js';
import { requestPasswordResetController, resetPasswordController } from './security/controller.js';
import { geofenceNotice, submitGeofenceAppeal } from './geofence/service.js';
import { z } from 'zod';
import { findUserById } from './repository.js';
import { bootstrapDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { createRequestContext } from '../../platform/dal/context.js';
import { unlockUser, userResource } from './security/unlock.js';
import { enabledModuleKeys } from '../../platform/module-entitlement.js';
import { effectivePolicy } from '@tapcrm/authz';
import { REGISTRY, globalAccess, isModuleName, type IdentityBootstrap, type IdentityBootstrapCapability } from '@tapcrm/contracts';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../config.js';

async function bootstrapCapabilities(
  ctx: RequestContext,
  enabledModules: ReadonlySet<string>,
): Promise<IdentityBootstrapCapability[]> {
  const actions = Object.keys(REGISTRY) as (keyof typeof REGISTRY)[];
  const enabledActions = actions.filter((action) => enabledModules.has(REGISTRY[action].module));
  if (globalAccess(ctx.principal)) {
    return enabledActions.map((action) => ({ action, scope: 'global' as const }));
  }
  if (ctx.principal.accountType === 'service') {
    const { allowedActions } = ctx.principal;
    return enabledActions
      .filter((action) => allowedActions.includes(action))
      .map((action) => ({ action, scope: 'own' as const }));
  }
  const policies = await Promise.all(enabledActions.map((action) => effectivePolicy(ctx, action)));
  return enabledActions.flatMap((action, index) => {
    const policy = policies[index];
    return policy?.allowed ? [{ action, scope: policy.scope }] : [];
  });
}

export function registerIdentityRoutes(): void {
  route({
    method: 'POST',
    path: '/api/identity/users/:id/unlock',
    action: 'identity:unlock-account',
    module: 'identity',
    resourceParam: 'id',
    loadResource: (ctx: RequestContext, id: string) => userResource(ctx, id),
    handler: async ({ ctx, params }) => unlockUser(ctx, params['id']!),
  });
}

export function registerIdentityPublicRoutes(router: Router): void {
  installPrincipalResolver(resolvePrincipal);
  installSocketPrincipalResolver(async (token, options) => resolvePrincipalFromToken(token, options).catch(() => null));
  router.post('/identity/login', loginController);
  router.post('/identity/refresh', refreshController);
  router.post('/identity/logout', logoutController);
  router.get('/identity/sessions', listSessionsController);
  router.post('/identity/sessions/:id/revoke', revokeSessionController);
  router.post('/identity/sessions/revoke-all', revokeAllSessionsController);
  router.post('/identity/password/reset/request', requestPasswordResetController);
  router.post('/identity/password/reset', resetPasswordController);
  router.post('/identity/password/change', changeTemporaryPasswordController);
  router.post('/identity/invitations/accept', acceptAdminInvitation);
  router.post('/identity/employee/setup', setupEmployeePassword);
  router.get('/identity/employee/setup/verify', verifyEmployeeSetupToken);
  const handleEmployeeSetupRedirect = (req: { url: string }, res: { redirect: (status: number, url: string) => void }) => {
    const config = loadConfig();
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(302, `${config.CLIENT_ORIGIN}/employee/setup${query}`);
  };
  router.get('/identity/employee/setup', handleEmployeeSetupRedirect);
  router.get('/employee/setup', handleEmployeeSetupRedirect);
  router.get('/identity/me', async (req, res, next) => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
      const user = await findUserById(resolved.principal.id, resolved.organizationId);
      if (!user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
      const organization = await bootstrapDb.readAs<{ id: string; code: string; name: string; status: string; timezone: string }>(resolved.organizationId, sql`
        SELECT id, code, name, status, timezone FROM organization WHERE id = ${resolved.organizationId}
      `);
      const ctx = createRequestContext({
        organizationId: resolved.organizationId,
        principal: resolved.principal,
        requestId: randomUUID(),
      });
      const enabledModules = (await enabledModuleKeys(resolved.organizationId)).filter(isModuleName);
      const capabilities = await bootstrapCapabilities(ctx, new Set(enabledModules));
      let departmentCode: string | null = null;
      let departmentName: string | null = null;
      let positionCode: string | null = null;
      let positionName: string | null = null;

      if (user.departmentId || user.positionId) {
        const details = await bootstrapDb.readAs<{
          departmentCode: string | null;
          departmentName: string | null;
          positionCode: string | null;
          positionName: string | null;
        }>(resolved.organizationId, sql`
          SELECT d.code AS department_code, d.name AS department_name,
                 p.code AS position_code, p.name AS position_name
          FROM app_user u
          LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
          LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
          WHERE u.id = ${user.id} AND u.organization_id = ${resolved.organizationId}
        `);
        if (details[0]) {
          departmentCode = details[0].departmentCode;
          departmentName = details[0].departmentName;
          positionCode = details[0].positionCode;
          positionName = details[0].positionName;
        }
      }

      const data: IdentityBootstrap = {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          accountType: user.accountType,
          departmentId: user.departmentId ?? null,
          departmentCode,
          departmentName,
          positionId: user.positionId ?? null,
          positionCode,
          positionName,
        },
        organization: organization[0] ?? null,
        enabledModules,
        capabilities,
      };
      res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
  });
  router.get('/identity/geofence/notice', async (req, res, next) => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
      const data = await geofenceNotice(resolved.organizationId, resolved.principal.id);
      res.status(200).json({ success: true, data });
    } catch (error) { next(error); }
  });
  router.post('/identity/geofence/appeal', async (req, res, next) => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
      const body = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMetres: z.number().int().nonnegative().nullable(), reason: z.string().trim().min(1).max(1000) }).parse(req.body ?? {});
      const data = await submitGeofenceAppeal({ ...body, organizationId: resolved.organizationId, userId: resolved.principal.id });
      res.status(201).json({ success: true, data });
    } catch (error) { next(error); }
  });
}
