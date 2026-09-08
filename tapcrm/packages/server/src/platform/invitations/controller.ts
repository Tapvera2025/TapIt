import type { Request, Response } from 'express';
import { z } from 'zod';
import { createInvitation, resendInvitation } from './service.js';
import { listInvitations, revokeInvitation } from './service.js';
import { pagination, success } from '../http/envelope.js';

const emailSchema = z.object({ email: z.string().trim().email() });

export async function inviteAdmin(req: Request, res: Response) {
  const body = emailSchema.parse(req.body);
  const result = await createInvitation({
    organizationId: String(req.params['id'] ?? ''),
    email: body.email,
    createdBy: req.platformCtx!.principal.platformUserId,
  });
  res.status(201).json({ success: true, data: result });
}

export async function resendAdmin(req: Request, res: Response) {
  const body = emailSchema.parse(req.body);
  const result = await resendInvitation({
    organizationId: String(req.params['id'] ?? ''),
    email: body.email,
    createdBy: req.platformCtx!.principal.platformUserId,
  });
  res.status(200).json({ success: true, data: result });
}

const statuses = ['ACCEPTED', 'REVOKED', 'EXPIRED', 'PENDING'] as const;

export async function listInvitationController(req: Request, res: Response) {
  const { page, limit } = pagination(req.query);
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
  const rawStatus = typeof req.query['status'] === 'string' ? req.query['status'].toUpperCase() : undefined;
  if (rawStatus && !statuses.includes(rawStatus as (typeof statuses)[number]))
    return res.status(422).json({ success: false, message: 'Invalid invitation status' });
  const result = await listInvitations({
    page,
    limit,
    ...(search ? { search } : {}),
    ...(rawStatus ? { status: rawStatus as (typeof statuses)[number] } : {}),
  });
  return res.json(success({ items: result.items, totalCount: result.totalCount, page, limit }));
}

export async function revokeInvitationController(req: Request, res: Response) {
  const id = String(req.params['id'] ?? '');
  return res.json({ success: true, data: await revokeInvitation(id) });
}
