import { globalAccess } from '@tapcrm/contracts';
import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { LeadNotFoundError, LeadValidationError, LEAD_ERROR_CODES } from './errors.js';
import { notifyCallback } from './callback-notifications.js';
import { findCallback, insertCallback, listCallbacks, loadCallbackResource as loadCallbackResourceRow, markCallbackRescheduled, updateCallbackStatus } from './callback-repository.js';
import { insertActivity, insertAudit, loadLeadResource } from './repository.js';
import { findLeadHandoverResource } from '../handover/repository.js';
import { leadPolicy } from './policy.js';
import { scopeResolver } from '../../../platform/authz-adapter.js';
import type { LeadCallback } from './types.js';
import { isValidCallbackTransition } from './callback-state.js';
import { isTerminalLeadStatus } from './lifecycle.js';
import type { CallbackListQuery, CallbackOutcomeInput, CreateCallbackInput, UpdateCallbackInput } from './validators.js';

export const loadCallbackResource = loadCallbackResourceRow;

async function assertLeadAccess(ctx: RequestContext, leadId: string): Promise<{ operationalOwnerId: string }> {
  const lead = await findLeadHandoverResource(ctx, leadId);
  if (!lead) throw new LeadNotFoundError();
  const operationalOwnerId = lead.currentHolderId ?? lead.ownerId;
  if (!operationalOwnerId) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'An unrouted lead cannot have a callback');
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'leads:view');
    const resource = await loadLeadResource(ctx, leadId);
    const inScope = Boolean(policy?.allowed && resource && await leadPolicy.check({ ...ctx, scope: scopeResolver }, 'leads:view', resource, policy.scope));
    if (!inScope || operationalOwnerId !== ctx.principal.id) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the current operational holder may create a callback');
  }
  return { operationalOwnerId };
}

export async function scheduleCallbackInTransaction(tx: Tx, ctx: RequestContext, leadId: string, scheduledAt: Date, reason: string | null, createdBy: string): Promise<string> {
  const lead = await findLeadHandoverResource(ctx, leadId);
  if (lead && isTerminalLeadStatus(lead.status)) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'A converted or closed-lost Lead cannot have a callback');
  const operationalOwnerId = lead?.currentHolderId ?? lead?.ownerId;
  if (!operationalOwnerId) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'An unrouted lead cannot have a callback');
  const id = await insertCallback(tx, ctx.organizationId, { leadId, ownerId: operationalOwnerId, scheduledAt, reason, createdBy });
  await tx.query(sql`UPDATE lead SET status = 'callback_scheduled' WHERE organization_id = ${ctx.organizationId} AND id = ${leadId} AND status NOT IN ('converted', 'closed_lost')`);
  await insertActivity(tx, ctx.organizationId, leadId, 'callback.scheduled', ctx.principal.id, { callbackId: id, ownerId: operationalOwnerId, scheduledAt: scheduledAt.toISOString() });
  await notifyCallback(tx, ctx, operationalOwnerId, leadId, 'scheduled');
  return id;
}

export async function createCallback(ctx: RequestContext, input: CreateCallbackInput): Promise<LeadCallback> {
  await assertLeadAccess(ctx, input.leadId);
  const id = await db.transaction(ctx, (tx) => scheduleCallbackInTransaction(tx, ctx, input.leadId, input.scheduledAt, input.reason ?? null, ctx.principal.id));
  const callback = await findCallback(ctx, id); if (!callback) throw new LeadNotFoundError(); return callback;
}

export async function listLeadCallbacks(ctx: RequestContext, query: CallbackListQuery): Promise<LeadCallback[]> {
  const visibility = await visibilityFilter(ctx, 'callbacks:view', 'callback');
  const filters = [visibility]; if (query.leadId) filters.push(sql`c.lead_id = ${query.leadId}`); if (query.ownerId) filters.push(sql`c.owner_id = ${query.ownerId}`); if (query.from) filters.push(sql`c.scheduled_at >= ${query.from}`); if (query.to) filters.push(sql`c.scheduled_at < ${query.to}`); if (query.status !== 'all') filters.push(sql`c.status = ${query.status}`);
  return listCallbacks(ctx, sql.join(filters, ' AND '));
}

export async function getCallback(ctx: RequestContext, id: string): Promise<LeadCallback> { const callback = await findCallback(ctx, id); if (!callback) throw new LeadNotFoundError(); return callback; }

export async function updateCallback(ctx: RequestContext, id: string, input: UpdateCallbackInput): Promise<LeadCallback> {
  const callback = await getCallback(ctx, id); if (callback.ownerId !== ctx.principal.id && !globalAccess(ctx.principal)) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the callback owner may reschedule it'); if (!isValidCallbackTransition(callback.status, 'rescheduled')) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'Only pending callbacks may be rescheduled');
  const nextId = await db.transaction(ctx, async (tx) => { await markCallbackRescheduled(tx, ctx.organizationId, id); const nextId = await insertCallback(tx, ctx.organizationId, { leadId: callback.leadId, ownerId: callback.ownerId, scheduledAt: input.scheduledAt, reason: input.reason === undefined ? callback.reason : input.reason, parentCallbackId: id, createdBy: ctx.principal.id }); await insertActivity(tx, ctx.organizationId, callback.leadId, 'callback.rescheduled', ctx.principal.id, { callbackId: id, nextCallbackId: nextId, scheduledAt: input.scheduledAt.toISOString() }); await insertAudit(tx, ctx, 'callback.rescheduled', id, callback, { nextCallbackId: nextId, scheduledAt: input.scheduledAt }, 'callback'); await notifyCallback(tx, ctx, callback.ownerId, callback.leadId, 'scheduled'); return nextId; });
  const next = await getCallback(ctx, nextId); return next;
}

export async function completeCallback(ctx: RequestContext, id: string, input: CallbackOutcomeInput): Promise<LeadCallback> {
  const callback = await getCallback(ctx, id); if (callback.ownerId !== ctx.principal.id && !globalAccess(ctx.principal)) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the callback owner may record its outcome'); if (!isValidCallbackTransition(callback.status, input.status)) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'This callback is already finalized');
  await db.transaction(ctx, async (tx) => { await updateCallbackStatus(tx, ctx.organizationId, id, input.status, input.outcome ?? null); const event = input.status === 'completed' ? 'callback.completed' : input.status === 'missed' ? 'callback.missed' : input.status === 'not_reachable' ? 'callback.missed' : 'callback.cancelled'; await insertActivity(tx, ctx.organizationId, callback.leadId, event, ctx.principal.id, { callbackId: id, outcome: input.outcome ?? null }); if (input.status === 'missed') { const stalled = await tx.query<{ id: string }>(sql`UPDATE lead SET stalled_at = COALESCE(stalled_at, now()), stalled_reason = COALESCE(stalled_reason, 'missed_callback') WHERE organization_id = ${ctx.organizationId} AND id = ${callback.leadId} AND stalled_at IS NULL RETURNING id`); if (stalled.length) await insertActivity(tx, ctx.organizationId, callback.leadId, 'lead.stalled', ctx.principal.id, { reason: 'missed_callback', callbackId: id }); } await insertAudit(tx, ctx, `callback.${input.status}`, id, { status: callback.status }, { status: input.status, outcome: input.outcome ?? null }, 'callback'); await notifyCallback(tx, ctx, callback.ownerId, callback.leadId, input.status === 'not_reachable' ? 'missed' : input.status); });
  return getCallback(ctx, id);
}
