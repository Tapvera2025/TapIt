import { Router } from 'express';
import { platformContext } from './auth/context.js';
import { buildAuthRouter } from './auth/routes.js';
import {
  listController,
  getController,
  createController,
  updateController,
  deleteController,
  activateController,
  suspendController,
  adminController,
} from './organizations/controller.js';
import {
  catalogController,
  organizationModulesController,
  enableController,
  disableController,
} from './modules/controller.js';
import { inviteAdmin, resendAdmin, listInvitationController, revokeInvitationController } from './invitations/controller.js';
import { dashboardController, statsController } from './dashboard/controller.js';

/** Exact platform routes agreed for the Master Admin control plane. */
export function buildPlatformRouter(): Router {
  const router = Router();
  router.use('/auth', buildAuthRouter());
  router.use(platformContext);

  router.get('/dashboard', dashboardController);
  router.get('/dashboard/stats', statsController);
  router.get('/invitations', listInvitationController);
  router.post('/invitations/:id/revoke', revokeInvitationController);

  router.get('/modules', catalogController);

  router.get('/organizations', listController);
  router.post('/organizations', createController);
  router.patch('/organizations/:id', updateController);
  router.delete('/organizations/:id', deleteController);
  router.get('/organizations/:id', getController);
  router.post('/organizations/:id/activate', activateController);
  router.post('/organizations/:id/suspend', suspendController);
  router.get('/organizations/:id/modules', organizationModulesController);
  router.post('/organizations/:id/modules/:moduleKey/enable', enableController);
  router.post('/organizations/:id/modules/:moduleKey/disable', disableController);
  router.get('/organizations/:id/admin', adminController);
  router.post('/organizations/:id/admin/invite', inviteAdmin);
  router.post('/organizations/:id/admin/resend', resendAdmin);

  return router;
}
