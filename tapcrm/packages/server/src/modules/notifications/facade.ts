import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { outboxPayloadSchema, type NotifyInput } from './types.js';

/**
 * NotificationFacade — the ONLY thing other modules import from here (MB-1).
 *
 * Call it INSIDE your business transaction:
 *
 *   await db.transaction(ctx, async (tx) => {
 *     await assignLead(tx, leadId, userId);
 *     await notify(tx, ctx, {
 *       type: 'lead.assigned',
 *       priority: 'operational',
 *       audience: { users: [userId] },
 *       title: 'New lead assigned',
 *       link: `/leads/${leadId}`,
 *       metadata: { leadId },
 *     });
 *   });
 *
 * It writes one `notification_outbox` row and nothing else — no socket, no
 * email, no audience lookup (TX-2). The dispatcher does those after commit, so:
 *   - a rolled-back business action produces NO notification;
 *   - a committed one produces exactly one, even if the socket layer is down;
 *   - a slow or failing channel can never fail or slow the caller.
 *
 * Throws only on a malformed call (a developer error): unknown action, empty
 * audience, non-path link. Delivery problems never surface here.
 */
export async function notify(tx: Tx, ctx: Pick<RequestContext, 'organizationId' | 'principal'>, input: NotifyInput): Promise<void> {
  const payload = outboxPayloadSchema.parse({
    type: input.type,
    priority: input.priority,
    title: input.title,
    body: input.body,
    link: input.link,
    metadata: input.metadata,
    expiresInDays: input.expiresInDays,
    audience: input.audience,
    actorId: ctx.principal.id,
  });

  await tx.query(sql`
    INSERT INTO notification_outbox (organization_id, payload)
    VALUES (${ctx.organizationId}, ${JSON.stringify(payload)}::jsonb)
  `);
}

export { NOTIFICATION_TYPES } from './types.js';
export type { NotifyInput, NotificationAudience, NotificationPriority } from './types.js';
