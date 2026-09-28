import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createRequestContext, type RequestContext } from '../../platform/dal/context.js';
import { NotFoundError } from '../../platform/http/error-handler.js';
import { emitToUser } from '../../platform/realtime/index.js';
import { resolvePrincipal } from '../identity/index.js';
import {
  countUnread,
  decodeCursor,
  encodeCursor,
  listForRecipient,
  markAllReadForRecipient,
  markOneRead,
} from './repository.js';

/**
 * The notification centre API.
 *
 * Every notification is personal, so these are self-service ("own") endpoints
 * like `/identity/sessions`: they need a logged-in user and nothing else. There
 * is no registry action and no position policy — the PRD grants `notifications`
 * at `own` scope to every principal, and each handler is scoped to
 * `ctx.principal.id`, so no caller can name another recipient.
 *
 * Mounted on the identity router, whose principal resolver authenticates the
 * bearer token (same session-version check as every other request).
 */

const listQuery = z.object({
  unread: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

type Handler = (ctx: RequestContext, req: Request) => Promise<unknown>;

/** Authenticates, builds the tenant context, and wraps the JSON envelope. */
function own(handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) {
        res.status(401).json({ success: false, message: 'Authentication required', code: 'IDENTITY_SESSION_EXPIRED' });
        return;
      }
      const ctx = createRequestContext({
        organizationId: resolved.organizationId,
        principal: resolved.principal,
        requestId: randomUUID(),
        sourceIp: req.ip ?? null,
      });
      res.status(200).json({ success: true, data: await handler(ctx, req) });
    } catch (error) {
      next(error);
    }
  };
}

export function registerNotificationRoutes(router: Router): void {
  // GET /notifications?unread=true&limit=20&cursor=...
  router.get('/notifications', own(async (ctx, req) => {
    const query = listQuery.parse(req.query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    // One extra row tells us whether another page exists without a count query.
    const rows = await listForRecipient(ctx, { unreadOnly: query.unread === 'true', limit: query.limit + 1, cursor });
    const items = rows.slice(0, query.limit);
    const last = items[items.length - 1];
    return {
      notifications: items,
      unreadCount: await countUnread(ctx),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }));

  // GET /notifications/unread-count — cheap, for the badge on first paint.
  router.get('/notifications/unread-count', own(async (ctx) => ({ unreadCount: await countUnread(ctx) })));

  // POST /notifications/read-all — registered before /:id so it is not shadowed.
  router.post('/notifications/read-all', own(async (ctx) => {
    const updated = await markAllReadForRecipient(ctx);
    // Keep the user's other tabs in sync (RT-4: no bodies, just the change type).
    emitToUser(ctx.organizationId, ctx.principal.id, 'notification:read', { all: true });
    return { updated };
  }));

  // POST /notifications/:id/read
  router.post('/notifications/:id/read', own(async (ctx, req) => {
    const { id } = idParam.parse(req.params);
    const notification = await markOneRead(ctx, id);
    // Unknown and someone-else's are indistinguishable on purpose.
    if (!notification) throw new NotFoundError('Notification');
    emitToUser(ctx.organizationId, ctx.principal.id, 'notification:read', { id });
    return { notification };
  }));
}
