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

  // -------------------------------------------------------------------
  // 3. Candidate Acknowledge Joining
  // -------------------------------------------------------------------
  router.get('/acknowledge/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawToken = req.params['token'];
      const token = Array.isArray(rawToken) ? (rawToken[0] ?? '') : (rawToken ?? '');
      const forwardedFor = req.headers['x-forwarded-for'];
      const ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim()
        ?? req.socket.remoteAddress
        ?? '';

      await service.acknowledgeJoining(token, ip);

      res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Joining Confirmed</title>
          <style>
            body { font-family: system-ui, sans-serif; display: flex; align-items: center;
                   justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
            .card { background: white; border-radius: 12px; padding: 40px; max-width: 420px;
                    text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
            h1 { color: #10b981; margin-bottom: 12px; font-size: 1.5rem; }
            p { color: #6b7280; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✓ Joining Confirmed</h1>
            <p>Thank you for confirming your joining. We look forward to welcoming you aboard!</p>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
