import { globalAccess } from '@tapcrm/contracts';
import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { LeadNotFoundError, LeadValidationError, LEAD_ERROR_CODES } from './errors.js';
import { notifyCallback } from './callback-notifications.js';
import { findCallback, insertCallback, listCallbacks, loadCallbackResource as loadCallbackResourceRow, updateCallbackSchedule, updateCallbackStatus } from './callback-repository.js';
import { findLeadHandoverResource, insertActivity, insertAudit } from './repository.js';
import type { LeadCallback } from './types.js';
import type { CallbackListQuery, CallbackOutcomeInput, CreateCallbackInput, UpdateCallbackInput } from './validators.js';

export const loadCallbackResource = loadCallbackResourceRow;

async function assertLeadAccess(ctx: RequestContext, leadId: string): Promise<{ ownerId: string }> {
  const lead = await findLeadHandoverResource(ctx, leadId);
  if (!lead) throw new LeadNotFoundError();
  if (!globalAccess(ctx.principal) && lead.ownerId !== ctx.principal.id && lead.currentHolderId !== ctx.principal.id) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Lead is outside the permitted Sales scope');
  if (!lead.ownerId) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'An unrouted lead cannot have a callback');
  return { ownerId: lead.ownerId };
}

export async function scheduleCallbackInTransaction(tx: Tx, ctx: RequestContext, leadId: string, scheduledAt: Date, reason: string | null, createdBy: string): Promise<string> {
  const lead = await findLeadHandoverResource(ctx, leadId);
  if (!lead?.ownerId) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'An unrouted lead cannot have a callback');
  const id = await insertCallback(tx, ctx.organizationId, { leadId, ownerId: lead.ownerId, scheduledAt, reason, createdBy });
  await tx.query(sql`UPDATE lead SET status = 'callback_scheduled' WHERE organization_id = ${ctx.organizationId} AND id = ${leadId} AND status NOT IN ('converted', 'closed_lost')`);
  await insertActivity(tx, ctx.organizationId, leadId, 'callback.scheduled', ctx.principal.id, { callbackId: id, ownerId: lead.ownerId, scheduledAt: scheduledAt.toISOString() });
  await notifyCallback(tx, ctx, lead.ownerId, leadId, 'scheduled');
  return id;
}

export async function createCallback(ctx: RequestContext, input: CreateCallbackInput): Promise<LeadCallback> {
  await assertLeadAccess(ctx, input.leadId);
  const id = await db.transaction(ctx, (tx) => scheduleCallbackInTransaction(tx, ctx, input.leadId, input.scheduledAt, input.reason ?? null, ctx.principal.id));
  const callback = await findCallback(ctx, id); if (!callback) throw new LeadNotFoundError(); return callback;
}

export async function listLeadCallbacks(ctx: RequestContext, query: CallbackListQuery): Promise<LeadCallback[]> {
  const visibility = await visibilityFilter(ctx, 'callbacks:view', 'callback');
  const filters = [visibility]; if (query.leadId) filters.push(sql`c.lead_id = ${query.leadId}`); if (query.status !== 'all') filters.push(sql`c.status = ${query.status}`);
  return listCallbacks(ctx, sql.join(filters, ' AND '));
}

export async function getCallback(ctx: RequestContext, id: string): Promise<LeadCallback> { const callback = await findCallback(ctx, id); if (!callback) throw new LeadNotFoundError(); return callback; }

export async function updateCallback(ctx: RequestContext, id: string, input: UpdateCallbackInput): Promise<LeadCallback> {
  const callback = await getCallback(ctx, id); if (callback.ownerId !== ctx.principal.id && !globalAccess(ctx.principal)) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the callback owner may reschedule it'); if (callback.status !== 'scheduled') throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'Only scheduled callbacks may be changed');
  await db.transaction(ctx, async (tx) => { await updateCallbackSchedule(tx, ctx.organizationId, id, input.scheduledAt ?? callback.scheduledAt, input.reason === undefined ? callback.reason : input.reason); await insertActivity(tx, ctx.organizationId, callback.leadId, 'callback.rescheduled', ctx.principal.id, { callbackId: id }); await insertAudit(tx, ctx, 'callback.rescheduled', id, callback, input, 'callback'); });
  return getCallback(ctx, id);
}

export async function completeCallback(ctx: RequestContext, id: string, input: CallbackOutcomeInput): Promise<LeadCallback> {
  const callback = await getCallback(ctx, id); if (callback.ownerId !== ctx.principal.id && !globalAccess(ctx.principal)) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the callback owner may record its outcome'); if (callback.status !== 'scheduled') throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'This callback is already finalized');
  await db.transaction(ctx, async (tx) => { await updateCallbackStatus(tx, ctx.organizationId, id, input.status); const event = input.status === 'completed' ? 'callback.completed' : input.status === 'missed' ? 'callback.missed' : 'callback.cancelled'; await insertActivity(tx, ctx.organizationId, callback.leadId, event, ctx.principal.id, { callbackId: id }); if (input.status === 'missed') { const stalled = await tx.query<{ id: string }>(sql`UPDATE lead SET stalled_at = COALESCE(stalled_at, now()), stalled_reason = COALESCE(stalled_reason, 'missed_callback') WHERE organization_id = ${ctx.organizationId} AND id = ${callback.leadId} AND stalled_at IS NULL RETURNING id`); if (stalled.length) await insertActivity(tx, ctx.organizationId, callback.leadId, 'lead.stalled', ctx.principal.id, { reason: 'missed_callback', callbackId: id }); } await insertAudit(tx, ctx, `callback.${input.status}`, id, { status: callback.status }, { status: input.status }, 'callback'); await notifyCallback(tx, ctx, callback.ownerId, callback.leadId, input.status); });
  return getCallback(ctx, id);
}
