import express, { Router, type Request, type Response, type NextFunction } from 'express';
import {
  GBP_SIGNATURE_HEADER,
  GbpMalformedBodyError,
  ingestExotelCall,
} from './service.js';

function signatureFrom(req: Request): string | undefined {
  const header = req.header(GBP_SIGNATURE_HEADER);
  if (header === undefined) return undefined;
  return Array.isArray(header) ? header[0] : header;
}

/**
 * Exotel posts form-urlencoded webhook bodies. Mounted BEFORE
 * `express.json`; the raw bytes feed signature verification while the
 * parsed params feed the service.
 */
export function buildGbpWebhookRouter(): Router {
  const router = Router();

  router.post(
    '/',
    express.raw({ type: () => true, limit: '512kb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        const contentType = req.header('content-type') ?? '';
        if (!contentType.startsWith('application/x-www-form-urlencoded')) {
          throw new GbpMalformedBodyError({ message: 'Content-Type must be application/x-www-form-urlencoded' });
        }
        const params = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
        const url = `${req.protocol}://${req.get('host') ?? ''}${req.originalUrl}`;
        const result = await ingestExotelCall({
          rawBody,
          params,
          url,
          signatureHeader: signatureFrom(req),
        });
        res.status(202).json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
