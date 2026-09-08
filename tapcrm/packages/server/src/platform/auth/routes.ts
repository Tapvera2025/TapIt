import { Router } from 'express';
import { platformContext } from './context.js';
import { loginController, refreshController, logoutController } from './controller.js';

export function buildAuthRouter(): Router {
  const router = Router();
  router.post('/login', loginController);
  router.post('/refresh', refreshController);
  router.post('/logout', platformContext, logoutController);
  return router;
}
