import { globalAccess } from '@tapcrm/contracts';
import { visibilityFilter } from '@tapcrm/authz';
import { db } from '../../../platform/dal/db.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { sql } from '../../../platform/dal/sql.js';
import { LeadNotFoundError, LeadValidationError, LEAD_ERROR_CODES } from '../leads/errors.js';
import { scheduleCallbackInTransaction } from '../leads/callback-service.js';
import { closeLeadAsLostInTransaction, isTerminalLeadStatus } from '../leads/lifecycle.js';
import { insertActivity, insertAudit } from '../leads/repository.js';
import { notifyHandoverOffered, notifyHandoverOutcome, notifyHandoverQueued } from './notifications.js';
import { HandoverConflictError, HandoverNotFoundError, HANDOVER_ERROR_CODES } from './errors.js';
import { acceptHandover, claimQueuedHandover, declineHandover, expirePendingHandovers, findHandover, findHandoverTx, findLeadHandoverResource, hasPendingHandover, insertHandover, insertHandoverAnnotation, listHandoverTargets, listHandovers as listHandoverRows, loadHandoverResource as loadHandoverResourceRow, loadSelectableHandoverTargetTx, recordHandoverDisposition } from './repository.js';
import type { Handover, HandoverTarget } from './types.js';
import type { CreateHandoverInput, DeclineHandoverInput, HandoverAnnotationInput, HandoverDispositionInput, HandoverListQuery } from './validators.js';

const HANDOVER_EXPIRY_MINUTES = 5;

async function expireHandovers(ctx: RequestContext): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const expired = await expirePendingHandovers(tx, ctx.organizationId, HANDOVER_EXPIRY_MINUTES);
    for (const handover of expired) {
      await insertActivity(tx, ctx.organizationId, handover.leadId, 'handover.expired', ctx.principal.id, { handoverId: handover.id });
      await insertAudit(tx, ctx, 'handover.expired', handover.id, { status: 'pending' }, { status: 'expired' });
      if (handover.toUserId) await notifyHandoverOutcome(tx, ctx, handover.leadId, [handover.toUserId], 'expired');
    }
  });
}

export async function getHandoverTargets(ctx: RequestContext, leadId: string): Promise<HandoverTarget[]> {
  const lead = await findLeadHandoverResource(ctx, leadId);
  if (!lead || (!globalAccess(ctx.principal) && lead.currentHolderId !== ctx.principal.id)) throw new LeadNotFoundError();
  return listHandoverTargets(ctx);
}

export async function createHandover(ctx: RequestContext, input: CreateHandoverInput): Promise<Handover> {
  await expireHandovers(ctx);
  const lead = await findLeadHandoverResource(ctx, input.leadId);
  if (!lead) throw new LeadNotFoundError();
  if (isTerminalLeadStatus(lead.status)) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'A converted or closed-lost Lead cannot be handed over');
  if (!globalAccess(ctx.principal) && lead.currentHolderId !== ctx.principal.id) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the current live-call handler may offer a handover');
  const targets = await listHandoverTargets(ctx);
  const handoverMode = input.handoverMode;
  const target = input.toUserId ? targets.find((candidate) => candidate.id === input.toUserId) : null;
  if (handoverMode === 'direct') {
    if (!target) throw new LeadValidationError(HANDOVER_ERROR_CODES.INVALID, 'Target is not an eligible Sales Supervisor or Team Lead');
    if (!target.selectable) throw new LeadValidationError(HANDOVER_ERROR_CODES.UNAVAILABLE, 'Target is not currently punched in or available');
  } else {
    if (!lead.salesTeamId) throw new LeadValidationError(HANDOVER_ERROR_CODES.INVALID, 'This Lead cannot be placed into a Sales team queue');
    if (targets.some((candidate) => candidate.selectable)) throw new LeadValidationError(HANDOVER_ERROR_CODES.INVALID, 'Select an available direct receiver before using the team queue');
  }
  if (await hasPendingHandover(ctx, input.leadId)) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'A handover is already pending for this lead');
  return db.transaction(ctx, async (tx) => {
    const id = await insertHandover(tx, ctx.organizationId, { leadId: input.leadId, fromUserId: ctx.principal.id, toUserId: input.toUserId ?? null, handoverMode, reason: input.reason ?? null, annotations: input.annotations ?? {} });
    await insertActivity(tx, ctx.organizationId, input.leadId, 'handover.offered', ctx.principal.id, { handoverId: id, toUserId: input.toUserId });
    await insertAudit(tx, ctx, 'handover.offered', id, null, { leadId: input.leadId, fromUserId: ctx.principal.id, toUserId: input.toUserId });
    if (handoverMode === 'team_queue') await notifyHandoverQueued(tx, ctx, input.leadId, targets.map((candidate) => candidate.id));
    else await notifyHandoverOffered(tx, ctx, input.leadId, input.toUserId!);
    const handover = await findHandoverTx(tx, ctx.organizationId, id); if (!handover) throw new HandoverNotFoundError(); return handover;
  });
}

export async function listHandovers(ctx: RequestContext, query: HandoverListQuery): Promise<Handover[]> {
  await expireHandovers(ctx);
  const visibility = await visibilityFilter(ctx, 'handovers:view', 'handover');
  const filter = query.leadId ? sql`${visibility} AND h.lead_id = ${query.leadId}` : visibility;
  const handovers = await listHandoverRows(ctx, query.status !== 'all' ? sql`${filter} AND h.status = ${query.status}` : filter);
  const queueVisible = query.status === 'all' || query.status === 'pending';
  const queueTarget = queueVisible && (await listHandoverTargets(ctx)).some((target) => target.id === ctx.principal.id);
  const queued = queueTarget ? await listHandoverRows(ctx, sql`h.status = 'pending' AND h.handover_mode = 'team_queue'${query.leadId ? sql` AND h.lead_id = ${query.leadId}` : sql``}`) : [];
  const combined = [...new Map([...handovers, ...queued].map((handover) => [handover.id, handover])).values()];
  return globalAccess(ctx.principal) ? combined : combined.filter((handover) => handover.fromUserId !== ctx.principal.id || handover.status === 'pending');
}

export async function getHandover(ctx: RequestContext, id: string): Promise<Handover> {
  await expireHandovers(ctx);
  const handover = await findHandover(ctx, id);
  if (!handover || (!globalAccess(ctx.principal) && handover.fromUserId === ctx.principal.id && handover.status !== 'pending')) throw new HandoverNotFoundError();
  return handover;
}
export const loadHandoverResource = loadHandoverResourceRow;

export async function addHandoverAnnotation(ctx: RequestContext, id: string, input: HandoverAnnotationInput): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  return db.transaction(ctx, async (tx) => {
    await insertHandoverAnnotation(tx, ctx.organizationId, id, ctx.principal.id, input.annotation);
    await insertAudit(tx, ctx, 'handover.annotation_added', id, null, { annotation: input.annotation }, 'handover');
    const result = await findHandoverTx(tx, ctx.organizationId, existing.id);
    if (!result) throw new HandoverNotFoundError();
    return result;
  });
}

export async function acceptLeadHandover(ctx: RequestContext, id: string): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  if (existing.handoverMode === 'team_queue' && existing.toUserId === null) return claimQueuedHandoverForUser(ctx, existing);
  if (existing.toUserId !== ctx.principal.id) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'Only the offered target may accept this handover');
  if (existing.status !== 'pending') throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This handover is no longer pending');
  const targets = await listHandoverTargets(ctx); const target = targets.find((candidate) => candidate.id === ctx.principal.id);
  if (!target?.selectable) throw new HandoverConflictError(HANDOVER_ERROR_CODES.UNAVAILABLE, 'You are not currently punched in or available');
  return db.transaction(ctx, async (tx) => {
    if (!await acceptHandover(tx, ctx.organizationId, id)) throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This handover is no longer pending');
    const leadUpdate = await tx.query<{ id: string; status: string }>(sql`UPDATE lead SET current_holder_id = ${ctx.principal.id} WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId} AND current_holder_id = ${existing.fromUserId} AND status NOT IN ('converted', 'closed_lost') RETURNING id, status`);
    if (!leadUpdate.length) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'The Lead is no longer held by the original operational owner');
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.accepted', ctx.principal.id, { handoverId: id, fromUserId: existing.fromUserId });
    await insertAudit(tx, ctx, 'handover.accepted', id, { status: 'pending' }, { status: 'accepted', currentHolderId: ctx.principal.id, ownerId: existing.fromUserId });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], 'accepted');
    const result = await findHandoverTx(tx, ctx.organizationId, id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}

async function claimQueuedHandoverForUser(ctx: RequestContext, existing: Handover): Promise<Handover> {
  return db.transaction(ctx, async (tx) => {
    const lead = await tx.maybeOne<{ currentHolderId: string | null; status: string }>(sql`SELECT current_holder_id AS "currentHolderId", status FROM lead WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId} FOR UPDATE`);
    if (!lead || lead.currentHolderId !== existing.fromUserId) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'The Lead is no longer available for this queued handover');
    if (isTerminalLeadStatus(String(lead.status))) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'A converted or closed-lost Lead cannot be handed over');
    const target = await loadSelectableHandoverTargetTx(tx, ctx.organizationId, ctx.principal.id);
    if (!target) throw new HandoverConflictError(HANDOVER_ERROR_CODES.UNAVAILABLE, 'You are not currently punched in or available');
    if (!await claimQueuedHandover(tx, ctx.organizationId, existing.id, ctx.principal.id)) throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This queued handover is no longer available');
    const leadUpdate = await tx.query(sql`UPDATE lead SET current_holder_id = ${ctx.principal.id} WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId} AND status NOT IN ('converted', 'closed_lost') RETURNING id`);
    if (!leadUpdate.length) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'A converted or closed-lost Lead cannot be handed over');
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.accepted', ctx.principal.id, { handoverId: existing.id, fromUserId: existing.fromUserId, handoverMode: 'team_queue' });
    await insertAudit(tx, ctx, 'handover.accepted', existing.id, { status: 'pending', handoverMode: 'team_queue' }, { status: 'accepted', currentHolderId: ctx.principal.id, ownerId: existing.fromUserId });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], 'accepted');
    const result = await findHandoverTx(tx, ctx.organizationId, existing.id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}

export async function declineLeadHandover(ctx: RequestContext, id: string, input: DeclineHandoverInput): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  if (existing.toUserId !== ctx.principal.id) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'Only the offered target may decline this handover');
  if (existing.status !== 'pending') throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This handover is no longer pending');
  return db.transaction(ctx, async (tx) => {
    if (!await declineHandover(tx, ctx.organizationId, id, input.reason)) throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This handover is no longer pending');
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.declined', ctx.principal.id, { handoverId: id, reason: input.reason });
    await insertAudit(tx, ctx, 'handover.declined', id, { status: 'pending' }, { status: 'declined', reason: input.reason });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], 'declined');
    const result = await findHandoverTx(tx, ctx.organizationId, id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}

export async function recordLeadHandoverDisposition(ctx: RequestContext, id: string, input: HandoverDispositionInput): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  const lead = await findLeadHandoverResource(ctx, existing.leadId);
  if (existing.toUserId !== ctx.principal.id) throw new HandoverConflictError(HANDOVER_ERROR_CODES.INVALID, 'Only the receiving handler may record disposition');
  if (existing.status !== 'accepted' || existing.disposition !== null) throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This handover cannot receive another disposition');
  return db.transaction(ctx, async (tx) => {
    if (!await recordHandoverDisposition(tx, ctx.organizationId, id, input.disposition, input.reason ?? null, input.annotations ?? {})) throw new HandoverConflictError(HANDOVER_ERROR_CODES.FINALIZED, 'This handover has already received a final disposition');
    if (input.disposition === 'rejected' && !await closeLeadAsLostInTransaction(tx, ctx.organizationId, existing.leadId, input.lossReason!)) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'The Lead cannot be closed as lost in its current lifecycle state');
    if (input.disposition === 'callback') { await tx.query(sql`UPDATE lead SET status = 'callback_scheduled' WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId}`); await scheduleCallbackInTransaction(tx, ctx, existing.leadId, input.scheduledAt!, input.reason ?? null, ctx.principal.id); }
    const event = input.disposition === 'rejected' ? 'lead.closed_lost' : input.disposition === 'callback' ? 'callback.requested' : 'deal.creation_requested';
    await insertActivity(tx, ctx.organizationId, existing.leadId, event, ctx.principal.id, { handoverId: id, disposition: input.disposition, reason: input.reason ?? null, lossReason: input.lossReason ?? null });
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.disposition_recorded', ctx.principal.id, { handoverId: id, disposition: input.disposition });
    await insertAudit(tx, ctx, `handover.${input.disposition}`, id, { status: 'accepted', disposition: null }, { status: 'accepted', disposition: input.disposition, ownerId: lead?.ownerId ?? null });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], input.disposition);
    const result = await findHandoverTx(tx, ctx.organizationId, id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}
