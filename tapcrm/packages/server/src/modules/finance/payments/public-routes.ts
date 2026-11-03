import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { handleWebhook } from './service.js';

function header(req: Request): string | undefined {
  return req.header('x-webhook-signature') ?? req.header('x-hyperswitch-signature');
}

export function buildPaymentWebhookRouter(): Router {
  const router = Router();
  router.post('/', express.raw({ type: 'application/json', limit: '2mb' }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handleWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), header(req));
      res.status(202).json({ success: true, data: result });
    } catch (error) { next(error); }
  });
  router.post('/:organizationId/:provider', express.raw({ type: 'application/json', limit: '2mb' }), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = Array.isArray(req.params['organizationId']) ? req.params['organizationId'][0] : req.params['organizationId'];
      const provider = Array.isArray(req.params['provider']) ? req.params['provider'][0] : req.params['provider'];
      const hints = organizationId && provider ? { organizationId, provider } : {};
      const result = await handleWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.from(''), header(req), hints);
      res.status(202).json({ success: true, data: result });
    } catch (error) { next(error); }
  });
  return router;
}
