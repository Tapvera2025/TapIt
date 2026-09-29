import { Router, type Request, type Response, type NextFunction } from 'express';
import * as service from './service.js';
import { publicApplySchema } from './validators.js';

function paramToken(req: Request): string {
  const val = req.params['token'];
  return (Array.isArray(val) ? val[0] : val) ?? '';
}

/**
 * Public routes for candidate student application form.
 * Mounted before tenant requestContext middleware because public applicants
 * have no authenticated user session or tenant cookie.
 */
export function buildPublicRecruitmentRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------
  // 1. View Public Job Requisition by Token
  // -------------------------------------------------------------------
  router.get('/apply/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = paramToken(req);
      const data = await service.resolvePublicApplicationLink(token);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 2. Submit Application & Resume by Token
  // -------------------------------------------------------------------
  router.post('/apply/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = paramToken(req);
      const input = publicApplySchema.parse(req.body ?? {});
      const data = await service.submitPublicApplication(token, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
