import { Router, type Request, type Response, type NextFunction } from 'express';
import { NotFoundError } from '../../platform/http/error-handler.js';
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
  //
  // GET only shows the page; the candidate's button POSTs the confirmation.
  // Mail security scanners open every link in an email, so a GET that
  // confirmed used to mark joinings confirmed before anyone read them.
  // -------------------------------------------------------------------
  router.get('/acknowledge/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await service.joiningAcknowledgementState(paramToken(req));
      if (state === 'invalid') {
        sendPage(res, 404, 'Link not valid', 'This confirmation link is not valid. Please contact the company that sent it.');
      } else if (state === 'acknowledged') {
        sendPage(res, 200, 'Joining confirmed', 'You have already confirmed your joining. We look forward to welcoming you aboard!');
      } else {
        sendPage(res, 200, 'Confirm your joining', 'Press the button below to confirm that you will be joining.', true);
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/acknowledge/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // req.ip honours the proxy setting; the raw X-Forwarded-For header can
      // be set to anything by the client.
      await service.acknowledgeJoining(paramToken(req), req.ip ?? req.socket.remoteAddress ?? '');
      sendPage(res, 200, 'Joining confirmed', 'Thank you for confirming your joining. We look forward to welcoming you aboard!');
    } catch (error) {
      if (error instanceof NotFoundError) {
        sendPage(res, 404, 'Link not valid', 'This confirmation link is not valid. Please contact the company that sent it.');
        return;
      }
      next(error);
    }
  });

  return router;
}

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** A small standalone page; with `confirmButton`, a form that POSTs back to this same URL. */
function sendPage(res: Response, status: number, title: string, message: string, confirmButton = false): void {
  const form = confirmButton
    ? '<form method="post"><button type="submit">Confirm my joining</button></form>'
    : '';
  res
    .status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escape(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 420px;
            text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,.08); }
    h1 { color: #111827; margin-bottom: 12px; font-size: 1.5rem; }
    p { color: #6b7280; line-height: 1.6; }
    button { margin-top: 16px; padding: 12px 22px; border: 0; border-radius: 8px;
             background: #10b981; color: white; font-size: 1rem; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escape(title)}</h1>
    <p>${escape(message)}</p>
    ${form}
  </div>
</body>
</html>`);
}
