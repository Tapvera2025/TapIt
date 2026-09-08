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
} from './controller.js';
import { requestPasswordResetController, resetPasswordController } from './security/controller.js';

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
  router.post('/identity/invitations/accept', acceptAdminInvitation);
}
