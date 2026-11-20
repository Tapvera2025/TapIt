import type { Request, Response } from 'express';
import { pagination, success } from '../http/envelope.js';
import { EMAIL_STATUSES, claimForRetry, countsByStatus, getDetail, list, type EmailStatus } from '../email/log.js';
import { requeueEmail } from '../email/queue.js';

/** Master Admin only: the router mounts these behind platformContext. */

export async function listMailController(req: Request, res: Response) {
  const { page, limit } = pagination(req.query);
  const search = typeof req.query['search'] === 'string' ? req.query['search'].trim() : '';
  const rawStatus = typeof req.query['status'] === 'string' ? req.query['status'].toUpperCase() : '';
  if (rawStatus && !EMAIL_STATUSES.includes(rawStatus as EmailStatus)) {
    return res.status(422).json({ success: false, message: 'Invalid email status' });
  }
  const [result, counts] = await Promise.all([
    list({ page, limit, ...(rawStatus ? { status: rawStatus as EmailStatus } : {}), ...(search ? { search } : {}) }),
    countsByStatus(),
  ]);
  return res.json(success({ items: result.items, totalCount: result.totalCount, page, limit, counts }));
}

export async function getMailController(req: Request, res: Response) {
  const mail = await getDetail(String(req.params['id'] ?? ''));
  if (!mail) return res.status(404).json({ success: false, message: 'Email not found' });
  return res.json(success(mail));
}

const RETRY_REFUSED = {
  'not-found': [404, 'Email not found'],
  'not-failed': [409, 'Only an email that failed can be sent again'],
  'no-body': [422, 'This email contained a one-time link or code, so its content is not kept. Send a fresh one from where it was first created (for example, re-send the invitation).'],
} as const;

export async function retryMailController(req: Request, res: Response) {
  const id = String(req.params['id'] ?? '');
  const claim = await claimForRetry(id);
  if ('reason' in claim) {
    const [status, message] = RETRY_REFUSED[claim.reason];
    return res.status(status).json({ success: false, message });
  }
  await requeueEmail(id, claim.message);
  return res.json(success({ id, status: 'QUEUED' }));
}
