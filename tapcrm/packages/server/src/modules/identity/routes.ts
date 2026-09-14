import type { Router } from 'express';
import { acceptAdminInvitation } from './invitations.js';
import { installPrincipalResolver } from '../../platform/http/context.js';
import { resolvePrincipal } from './service.js';
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
import { unlockUser, userResource } from './security/unlock.js';

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
  router.get('/identity/me', async (req, res, next) => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
      const user = await findUserById(resolved.principal.id, resolved.organizationId);
      if (!user) { res.status(401).json({ success: false, message: 'Authentication required' }); return; }
      const organization = await bootstrapDb.readAs<{ id: string; code: string; name: string; status: string }>(resolved.organizationId, sql`
        SELECT id, code, name, status FROM organization WHERE id = ${resolved.organizationId}
      `);
      res.status(200).json({ success: true, data: {
        user: { id: user.id, email: user.email, fullName: user.fullName, accountType: user.accountType },
        organization: organization[0] ?? null,
      } });
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
