import { globalAccess } from '@tapcrm/contracts';
import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import type { SqlFragment } from '@tapcrm/authz';
import { db } from '../../../platform/dal/db.js';
import { scopeResolver } from '../../../platform/authz-adapter.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { sql } from '../../../platform/dal/sql.js';
import { listTerritoriesForRouting } from '../territories/repository.js';
import { getRoutingConfiguration } from '../territories/service.js';
import { routeLead } from '../territories/router.js';
import { HandoverConflictError, HandoverNotFoundError, LeadNotFoundError, LeadValidationError, LEAD_ERROR_CODES } from './errors.js';
import { notifyHandoverOffered, notifyHandoverOutcome } from './handover-notifications.js';
import { scheduleCallbackInTransaction } from './callback-service.js';
import { normalizeLeadEmail, normalizeLeadPhone } from './normalization.js';
import { leadPolicy } from './policy.js';
import { acceptHandover, declineHandover, expirePendingHandovers, findCampaign, findDuplicatesTx, findHandover, findHandoverTx, findLead, findLeadHandoverResource, findLeadTx, findSource, findSourceTx, hasPendingHandover, insertActivity, insertAudit, insertHandover, insertLead, insertSource, listCampaigns, listHandoverTargets, listHandovers as listHandoverRows, listLeads as listRows, listSources, loadHandoverResource as loadHandoverResourceRow, loadLeadResource as loadResource, recordHandoverDisposition, updateLeadRow, updateSource } from './repository.js';
import type { Campaign, Handover, HandoverTarget, Lead, LeadCreateResult, LeadResource, LeadSource, PaginatedLeads } from './types.js';
import type { CreateHandoverInput, CreateLeadInput, DeclineHandoverInput, HandoverDispositionInput, HandoverListQuery, LeadListQuery, SourceInput, UpdateLeadInput, UpdateSourceInput } from './validators.js';

const LIFECYCLE_TRANSITIONS: Record<string, readonly string[]> = {
  new: ['assigned'], assigned: ['contacted'], contacted: ['discovery'], discovery: ['proposal_sent'],
  proposal_sent: ['follow_up'], follow_up: ['callback_scheduled', 'nurture'],
  callback_scheduled: ['contacted', 'follow_up', 'nurture'], nurture: ['contacted'],
};
export function isValidLifecycleTransition(from: string, to: string): boolean { return from === to || Boolean(LIFECYCLE_TRANSITIONS[from]?.includes(to)); }
function assertLifecycleTransition(from: string, to: string): void { if (!isValidLifecycleTransition(from, to)) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'Invalid Lead lifecycle transition: ' + from + ' → ' + to); }

async function assertManageScope(ctx: RequestContext, resource: LeadResource): Promise<void> {
  if (globalAccess(ctx.principal)) return;
  const policy = await effectivePolicy(ctx, 'leads:edit');
  if (!policy?.allowed || !await leadPolicy.check({ ...ctx, scope: scopeResolver }, 'leads:edit', resource, policy.scope)) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Lead is outside the permitted Sales scope');
}

export async function getSources(ctx: RequestContext): Promise<LeadSource[]> { return listSources(ctx); }
export async function getCampaigns(ctx: RequestContext): Promise<Campaign[]> { return listCampaigns(ctx); }
const HANDOVER_EXPIRY_MINUTES = 5;
async function expireHandovers(ctx: RequestContext): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const expired = await expirePendingHandovers(tx, ctx.organizationId, HANDOVER_EXPIRY_MINUTES);
    for (const handover of expired) {
      await insertActivity(tx, ctx.organizationId, handover.leadId, 'handover.expired', ctx.principal.id, { handoverId: handover.id });
      await insertAudit(tx, ctx, 'handover.expired', handover.id, { status: 'pending' }, { status: 'expired' });
      await notifyHandoverOutcome(tx, ctx, handover.leadId, [handover.toUserId], 'expired');
    }
  });
}

export async function getHandoverTargets(ctx: RequestContext, leadId: string): Promise<HandoverTarget[]> {
  const lead = await findLeadHandoverResource(ctx, leadId);
  if (!lead || (!globalAccess(ctx.principal) && lead.currentHolderId !== ctx.principal.id && lead.ownerId !== ctx.principal.id)) throw new LeadNotFoundError();
  return listHandoverTargets(ctx);
}

export async function createHandover(ctx: RequestContext, input: CreateHandoverInput): Promise<Handover> {
  await expireHandovers(ctx);
  const lead = await findLeadHandoverResource(ctx, input.leadId);
  if (!lead) throw new LeadNotFoundError();
  if (!globalAccess(ctx.principal) && lead.currentHolderId !== ctx.principal.id && lead.ownerId !== ctx.principal.id) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'Only the current live-call handler may offer a handover');
  const targets = await listHandoverTargets(ctx);
  const target = targets.find((candidate) => candidate.id === input.toUserId);
  if (!target) throw new LeadValidationError(LEAD_ERROR_CODES.HANDOVER_INVALID, 'Target is not an eligible Sales Supervisor or Team Lead');
  if (!target.selectable) throw new LeadValidationError(LEAD_ERROR_CODES.HANDOVER_UNAVAILABLE, 'Target is not currently punched in or available');
  if (await hasPendingHandover(ctx, input.leadId)) throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_INVALID, 'A handover is already pending for this lead');
  return db.transaction(ctx, async (tx) => {
    const id = await insertHandover(tx, ctx.organizationId, { leadId: input.leadId, fromUserId: ctx.principal.id, toUserId: input.toUserId, reason: input.reason ?? null, annotations: input.annotations ?? {} });
    await insertActivity(tx, ctx.organizationId, input.leadId, 'handover.offered', ctx.principal.id, { handoverId: id, toUserId: input.toUserId });
    await insertAudit(tx, ctx, 'handover.offered', id, null, { leadId: input.leadId, fromUserId: ctx.principal.id, toUserId: input.toUserId });
    await notifyHandoverOffered(tx, ctx, input.leadId, input.toUserId);
    const handover = await findHandoverTx(tx, ctx.organizationId, id); if (!handover) throw new HandoverNotFoundError(); return handover;
  });
}

export async function listHandovers(ctx: RequestContext, query: HandoverListQuery): Promise<Handover[]> {
  await expireHandovers(ctx);
  const visibility = await visibilityFilter(ctx, 'handovers:view', 'handover');
  const filter = query.leadId ? sql`${visibility} AND h.lead_id = ${query.leadId}` : visibility;
  return listHandoverRows(ctx, query.status !== 'all' ? sql`${filter} AND h.status = ${query.status}` : filter);
}
export async function getHandover(ctx: RequestContext, id: string): Promise<Handover> { await expireHandovers(ctx); const handover = await findHandover(ctx, id); if (!handover) throw new HandoverNotFoundError(); return handover; }
export const loadHandoverResource = loadHandoverResourceRow;

export async function acceptLeadHandover(ctx: RequestContext, id: string): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  if (existing.toUserId !== ctx.principal.id) throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_INVALID, 'Only the offered target may accept this handover');
  if (existing.status !== 'pending') throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_FINALIZED, 'This handover is no longer pending');
  const targets = await listHandoverTargets(ctx); const target = targets.find((candidate) => candidate.id === ctx.principal.id);
  if (!target?.selectable) throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_UNAVAILABLE, 'You are not currently punched in or available');
  return db.transaction(ctx, async (tx) => {
    await acceptHandover(tx, ctx.organizationId, id);
    await tx.query(sql`UPDATE lead SET current_holder_id = ${ctx.principal.id} WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId} AND current_holder_id = ${existing.fromUserId}`);
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.accepted', ctx.principal.id, { handoverId: id, fromUserId: existing.fromUserId });
    await insertAudit(tx, ctx, 'handover.accepted', id, { status: 'pending' }, { status: 'accepted', currentHolderId: ctx.principal.id, ownerId: existing.fromUserId });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], 'accepted');
    const result = await findHandoverTx(tx, ctx.organizationId, id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}

export async function declineLeadHandover(ctx: RequestContext, id: string, input: DeclineHandoverInput): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  if (existing.toUserId !== ctx.principal.id) throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_INVALID, 'Only the offered target may decline this handover');
  if (existing.status !== 'pending') throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_FINALIZED, 'This handover is no longer pending');
  return db.transaction(ctx, async (tx) => {
    await declineHandover(tx, ctx.organizationId, id, input.reason);
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.declined', ctx.principal.id, { handoverId: id, reason: input.reason });
    await insertAudit(tx, ctx, 'handover.declined', id, { status: 'pending' }, { status: 'declined', reason: input.reason });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], 'declined');
    const result = await findHandoverTx(tx, ctx.organizationId, id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}

export async function recordLeadHandoverDisposition(ctx: RequestContext, id: string, input: HandoverDispositionInput): Promise<Handover> {
  const existing = await getHandover(ctx, id);
  const lead = await findLeadHandoverResource(ctx, existing.leadId);
  if (existing.toUserId !== ctx.principal.id) throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_INVALID, 'Only the receiving handler may record disposition');
  if (existing.status !== 'accepted' || existing.disposition !== null) throw new HandoverConflictError(LEAD_ERROR_CODES.HANDOVER_FINALIZED, 'This handover cannot receive another disposition');
  return db.transaction(ctx, async (tx) => {
    await recordHandoverDisposition(tx, ctx.organizationId, id, input.disposition, input.reason ?? null, input.annotations ?? {});
    if (input.disposition === 'rejected') await tx.query(sql`UPDATE lead SET status = 'closed_lost', loss_reason = ${input.lossReason!}, lost_at = now(), current_holder_id = owner_id WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId}`);
    if (input.disposition === 'callback') { await tx.query(sql`UPDATE lead SET status = 'callback_scheduled', current_holder_id = owner_id WHERE organization_id = ${ctx.organizationId} AND id = ${existing.leadId}`); await scheduleCallbackInTransaction(tx, ctx, existing.leadId, input.scheduledAt!, input.reason ?? null, ctx.principal.id); }
    const event = input.disposition === 'rejected' ? 'lead.closed_lost' : input.disposition === 'callback' ? 'callback.requested' : 'deal.creation_requested';
    await insertActivity(tx, ctx.organizationId, existing.leadId, event, ctx.principal.id, { handoverId: id, disposition: input.disposition, reason: input.reason ?? null, lossReason: input.lossReason ?? null });
    await insertActivity(tx, ctx.organizationId, existing.leadId, 'handover.disposition_recorded', ctx.principal.id, { handoverId: id, disposition: input.disposition });
    await insertAudit(tx, ctx, `handover.${input.disposition}`, id, { status: 'accepted', disposition: null }, { status: 'accepted', disposition: input.disposition, ownerId: lead?.ownerId ?? null });
    await notifyHandoverOutcome(tx, ctx, existing.leadId, [existing.fromUserId], input.disposition);
    const result = await findHandoverTx(tx, ctx.organizationId, id); if (!result) throw new HandoverNotFoundError(); return result;
  });
}
export async function createSource(ctx: RequestContext, input: SourceInput): Promise<LeadSource> { return db.transaction(ctx, (tx) => insertSource(tx, ctx.organizationId, input)); }
export async function editSource(ctx: RequestContext, id: string, input: UpdateSourceInput): Promise<LeadSource> { return db.transaction(ctx, async (tx) => { const existing = await findSource(tx, ctx.organizationId, id); if (!existing) throw new LeadValidationError(LEAD_ERROR_CODES.SOURCE_INVALID, 'Lead source not found'); return updateSource(tx, ctx.organizationId, id, input); }); }

async function validateSourceAndCampaign(ctx: RequestContext, sourceId: string, campaignId: string | null): Promise<{ source: LeadSource; campaign: Campaign | null }> {
  return db.transaction(ctx, async (tx) => {
    const source = await findSourceTx(tx, ctx.organizationId, sourceId);
    if (!source || source.status !== 'active') throw new LeadValidationError(LEAD_ERROR_CODES.SOURCE_INVALID, 'Lead source is invalid or inactive');
    const campaign = campaignId ? await findCampaign(tx, ctx.organizationId, campaignId) : null;
    if (campaignId && (!campaign || campaign.status !== 'active')) throw new LeadValidationError(LEAD_ERROR_CODES.CAMPAIGN_INVALID, 'Campaign is invalid or inactive');
    return { source, campaign };
  });
}

async function validatePreviousLead(ctx: RequestContext, previousLeadId: string | null): Promise<void> {
  if (!previousLeadId) return;
  const previous = await findLead(ctx, previousLeadId);
  const resource = await loadResource(ctx, previousLeadId) as LeadResource | null;
  if (!previous || previous.status !== 'closed_lost' || !resource) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'Previous lead is not eligible for re-engagement');
  if (!globalAccess(ctx.principal)) {
    const policy = await effectivePolicy(ctx, 'leads:view');
    if (!policy?.allowed || !await leadPolicy.check({ ...ctx, scope: scopeResolver }, 'leads:view', resource, policy.scope)) throw new LeadValidationError(LEAD_ERROR_CODES.VALIDATION, 'Previous lead is not eligible for re-engagement');
  }
}

async function routingCandidates(ctx: RequestContext) {
  // Attendance/punch infrastructure is not implemented yet. Candidates are
  // deliberately marked unavailable rather than treating activity as punch-in.
  const rows = await db.query<{ id: string; teamId: string }>(ctx, sql`SELECT u.id, u.team_id AS "teamId" FROM app_user u JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id WHERE u.organization_id = ${ctx.organizationId} AND u.account_type = 'employee' AND u.status = 'active' AND p.code = 'sales-agent' AND u.team_id IS NOT NULL`);
  return rows.map((row) => ({ agentId: row.id, salesTeamId: row.teamId, openLeadCount: 0, active: true, punchedIn: false }));
}

export async function createLead(ctx: RequestContext, input: CreateLeadInput): Promise<LeadCreateResult> {
  await validatePreviousLead(ctx, input.previousLeadId ?? null);
  const { source, campaign } = await validateSourceAndCampaign(ctx, input.sourceId, input.campaignId ?? null);
  const territories = await listTerritoriesForRouting(ctx);
  const configuration = await getRoutingConfiguration(ctx);
  const outbound = source.direction === 'outbound';
  const decision = outbound ? { type: 'SKIPPED' as const, reason: 'AGENT_CREATED' as const, ownerId: ctx.principal.id } : routeLead({ ...input, source: source.name, origin: source.direction, territories, candidates: await routingCandidates(ctx), routingEnabled: configuration.enabled, assignmentStrategy: configuration.assignmentStrategy });
  const ownerId = decision.type === 'SKIPPED' ? decision.ownerId : decision.type === 'ASSIGNED' ? decision.agentId : null;
  const routingStatus = ownerId ? 'assigned' as const : 'unrouted' as const;
  const status = ownerId && input.status === 'new' ? 'assigned' as const : input.status;
  const resource = { type: 'lead' as const, id: 'new', organizationId: ctx.organizationId, ownerId, currentHolderId: ownerId, salesTeamId: decision.type === 'ASSIGNED' ? decision.salesTeamId : null, salesPoolId: null, departmentId: null };
  if (ownerId && !outbound) await assertManageScope(ctx, resource);
  return db.transaction(ctx, async (tx) => {
    const visibility = await visibilityFilter(ctx, 'leads:view', 'lead');
    const phone = normalizeLeadPhone(input.phone);
    const email = normalizeLeadEmail(input.email);
    const duplicates = await findDuplicatesTx(tx, ctx.organizationId, visibility, phone, email);
    const id = await insertLead(tx, ctx.organizationId, { sourceId: source.id, campaignId: campaign?.id ?? null, previousLeadId: input.previousLeadId ?? null, ownerId, currentHolderId: ownerId, territoryId: decision.type === 'ASSIGNED' ? decision.territoryId : null, salesTeamId: decision.type === 'ASSIGNED' ? decision.salesTeamId : null, salesPoolId: null, status, routingStatus, contactName: input.contactName, companyName: input.companyName ?? null, phone: input.phone ?? null, email: input.email ?? null, phoneNormalized: phone, emailNormalized: email, createdBy: ctx.principal.id });
    await insertActivity(tx, ctx.organizationId, id, 'lead.created', ctx.principal.id, { routingStatus });
    if (ownerId) await insertActivity(tx, ctx.organizationId, id, 'lead.assigned', ctx.principal.id, { ownerId });
    if (input.previousLeadId) await insertActivity(tx, ctx.organizationId, id, 'lead.reengaged', ctx.principal.id, { previousLeadId: input.previousLeadId });
    if (duplicates.length) await insertActivity(tx, ctx.organizationId, id, 'duplicate.warning', ctx.principal.id, { count: duplicates.length, leadIds: duplicates.map((duplicate) => duplicate.leadId) });
    await insertAudit(tx, ctx, 'lead.created', id, null, { ownerId, currentHolderId: ownerId, routingStatus, sourceId: source.id });
    const created = await findLeadTx(tx, ctx.organizationId, id);
    if (!created) throw new LeadNotFoundError();
    return { lead: created, duplicates };
  });
}

function queryFilter(query: LeadListQuery, scope: SqlFragment): SqlFragment {
  const filters: SqlFragment[] = [scope];
  if (query.status !== 'all') filters.push(sql`l.status = ${query.status}`);
  if (query.ownerId) filters.push(sql`l.owner_id = ${query.ownerId}`);
  if (query.sourceId) filters.push(sql`l.source_id = ${query.sourceId}`);
  if (query.campaignId) filters.push(sql`l.campaign_id = ${query.campaignId}`);
  if (query.territoryId) filters.push(sql`l.territory_id = ${query.territoryId}`);
  if (query.salesTeamId) filters.push(sql`l.sales_team_id = ${query.salesTeamId}`);
  if (query.salesPoolId) filters.push(sql`l.sales_pool_id = ${query.salesPoolId}`);
  if (query.search) { const search = `%${query.search}%`; filters.push(sql`(l.contact_name ILIKE ${search} OR l.company_name ILIKE ${search} OR l.phone ILIKE ${search} OR l.email::text ILIKE ${search})`); }
  return sql.join(filters, ' AND ');
}

export async function listLeads(ctx: RequestContext, query: LeadListQuery): Promise<PaginatedLeads> { const scope = await visibilityFilter(ctx, 'leads:view', 'lead'); const result = await listRows(ctx, queryFilter(query, scope), query); return { items: result.rows, total: result.total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) }; }
export async function listStalledLeads(ctx: RequestContext, query: LeadListQuery): Promise<PaginatedLeads> { const scope = await visibilityFilter(ctx, 'leads:view', 'lead'); const result = await listRows(ctx, queryFilter(query, sql`${scope} AND l.stalled_at IS NOT NULL`), query); return { items: result.rows, total: result.total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) }; }
export async function getLead(ctx: RequestContext, id: string): Promise<Lead> { const lead = await findLead(ctx, id); if (!lead) throw new LeadNotFoundError(); return lead; }
export async function updateLead(ctx: RequestContext, id: string, input: UpdateLeadInput): Promise<Lead> { const before = await getLead(ctx, id); const resource = await loadResource(ctx, id) as LeadResource | null; if (!resource) throw new LeadNotFoundError(); await assertManageScope(ctx, resource); if (input.status) { assertLifecycleTransition(before.status, input.status); if (input.status === 'assigned' && !resource.ownerId) throw new LeadValidationError(LEAD_ERROR_CODES.OWNER_INVALID, 'An unrouted lead cannot be marked assigned'); } return db.transaction(ctx, async (tx) => { await updateLeadRow(tx, ctx.organizationId, id, input, before, { phone: normalizeLeadPhone(input.phone === undefined ? before.phone : input.phone), email: normalizeLeadEmail(input.email === undefined ? before.email : input.email) }); const updated = await findLeadTx(tx, ctx.organizationId, id); if (!updated) throw new LeadNotFoundError(); if (input.status && input.status !== before.status) await insertActivity(tx, ctx.organizationId, id, input.status === 'nurture' ? 'lead.nurtured' : 'lead.status_changed', ctx.principal.id, { from: before.status, to: input.status }); await insertAudit(tx, ctx, 'lead.updated', id, { status: before.status }, { status: updated.status }); return updated; }); }
export const loadLeadResource = loadResource;
