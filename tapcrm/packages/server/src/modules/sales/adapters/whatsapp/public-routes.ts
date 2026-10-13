import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { ingestWhatsAppWebhook } from './service.js';
import type { WebhookRequest } from './driver.js';

function paramProvider(req: Request): string {
  const value = req.params['provider'];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function headersSnapshot(req: Request): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') snapshot[key.toLowerCase()] = value;
    else if (Array.isArray(value)) snapshot[key.toLowerCase()] = value[0];
  }
  return snapshot;
}

/**
 * One route for every WhatsApp provider. The driver name is a path
 * segment so a tenant can switch providers by rewriting a single URL.
 * Mounted BEFORE `express.json` to preserve the raw body for HMAC +
 * form-urlencoded parsing (Twilio).
 */
export function buildWhatsAppWebhookRouter(): Router {
  const router = Router();

  router.post(
    '/:provider',
    express.raw({ type: () => true, limit: '2mb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        const webhookReq: WebhookRequest = {
          rawBody,
          headers: headersSnapshot(req),
          url: `${req.protocol}://${req.get('host') ?? ''}${req.originalUrl}`,
        };
        const result = await ingestWhatsAppWebhook(paramProvider(req), webhookReq);
        res.status(202).json({
          success: true,
          data: {
            accepted: result.accepted,
            skipped: result.skipped,
            verdicts: result.verdicts,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
