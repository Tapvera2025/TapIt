import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { loadConfig } from '../../../../config.js';
import { META_SIGNATURE_HEADER, ingestMetaWebhook } from './service.js';

function signatureFrom(req: Request): string | null {
  const header = req.header(META_SIGNATURE_HEADER);
  if (header === undefined) return null;
  return Array.isArray(header) ? (header[0] ?? null) : header;
}

/**
 * Meta posts to a single URL for every tenant. GET requests carry the
 * subscription verification challenge; POST requests carry leadgen
 * change notifications. Mounted BEFORE `express.json` so the HMAC check
 * sees exactly the bytes Facebook signed.
 */
export function buildMetaWebhookRouter(): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const config = loadConfig();
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (
      mode === 'subscribe' &&
      typeof token === 'string' &&
      typeof challenge === 'string' &&
      config.META_WEBHOOK_VERIFY_TOKEN !== undefined &&
      token === config.META_WEBHOOK_VERIFY_TOKEN
    ) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('invalid verification request');
  });

  router.post(
    '/',
    express.raw({ type: 'application/json', limit: '2mb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const config = loadConfig();
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        const result = await ingestMetaWebhook({
          rawBody,
          signatureHeader: signatureFrom(req),
          appSecret: config.META_APP_SECRET,
        });
        res.status(202).json({
          success: true,
          data: { accepted: result.accepted, skipped: result.skipped, reasons: result.reasons },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
