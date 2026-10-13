import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { WEBSITE_INTAKE_SIGNATURE_HEADER, ingestWebsiteSubmission } from './service.js';

function connectorParam(req: Request): string {
  const value = req.params['connectorId'];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function signatureFrom(req: Request): string | null {
  const header = req.header(WEBSITE_INTAKE_SIGNATURE_HEADER);
  if (header === undefined) return null;
  return Array.isArray(header) ? (header[0] ?? null) : header;
}

/**
 * Public webhook router for website intake. Mounted BEFORE the global
 * `express.json` middleware so we see the raw bytes — HMAC verification
 * must happen over exactly what the sender signed, not a reserialized form.
 *
 * Returns 202 Accepted even on happy path: the body shape promises async
 * processing semantics so the caller never races the lead-detail refresh.
 */
export function buildWebsiteWebhookRouter(): Router {
  const router = Router();

  router.post(
    '/:connectorId',
    express.raw({ type: 'application/json', limit: '2mb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        const result = await ingestWebsiteSubmission(
          connectorParam(req),
          rawBody,
          signatureFrom(req),
        );
        res.status(202).json({
          success: true,
          data: {
            submissionId: result.submissionId,
            outcome: result.outcome,
            leadId: result.leadId ?? null,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
