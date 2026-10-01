import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { Handover, HandoverTarget } from './types.js';

const HANDOVER_SELECT = sql`
  SELECT h.id, h.organization_id AS "organizationId", h.lead_id AS "leadId",
         h.from_user_id AS "fromUserId", from_user.full_name AS "fromUserName",
         h.to_user_id AS "toUserId", to_user.full_name AS "toUserName",
         h.status, h.handover_mode AS "handoverMode", h.offered_at AS "offeredAt", h.accepted_at AS "acceptedAt",
         h.declined_at AS "declinedAt", h.expired_at AS "expiredAt",
         h.disposition, h.disposition_at AS "dispositionAt", h.reason, h.queue_claimed_at AS "queueClaimedAt",
         h.annotations, h.time_to_accept_seconds AS "timeToAcceptSeconds",
         h.time_to_outcome_seconds AS "timeToOutcomeSeconds",
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'authorId', a.author_id, 'annotation', a.annotation, 'createdAt', a.created_at) ORDER BY a.created_at) FROM lead_handover_annotation a WHERE a.organization_id = h.organization_id AND a.handover_id = h.id), '[]'::json) AS corrections
  FROM lead_handover h
  JOIN app_user from_user ON from_user.organization_id = h.organization_id AND from_user.id = h.from_user_id
  LEFT JOIN app_user to_user ON to_user.organization_id = h.organization_id AND to_user.id = h.to_user_id
  JOIN lead l ON l.organization_id = h.organization_id AND l.id = h.lead_id
  LEFT JOIN team ON team.organization_id = l.organization_id AND team.id = l.sales_team_id
`;

function mapHandover(row: Handover): Handover { return { ...row, offeredAt: new Date(row.offeredAt), acceptedAt: row.acceptedAt ? new Date(row.acceptedAt) : null, declinedAt: row.declinedAt ? new Date(row.declinedAt) : null, expiredAt: row.expiredAt ? new Date(row.expiredAt) : null, dispositionAt: row.dispositionAt ? new Date(row.dispositionAt) : null, queueClaimedAt: row.queueClaimedAt ? new Date(row.queueClaimedAt) : null }; }

export async function findHandover(ctx: RequestContext, id: string): Promise<Handover | null> { const row = await db.maybeOne<Handover>(ctx, sql`${HANDOVER_SELECT} WHERE h.organization_id = ${ctx.organizationId} AND h.id = ${id}`); return row ? mapHandover(row) : null; }
export async function findHandoverTx(tx: Tx, organizationId: string, id: string): Promise<Handover | null> { const row = await tx.maybeOne<Handover>(sql`${HANDOVER_SELECT} WHERE h.organization_id = ${organizationId} AND h.id = ${id}`); return row ? mapHandover(row) : null; }
export async function hasPendingHandover(ctx: RequestContext, leadId: string): Promise<boolean> { const row = await db.maybeOne<{ id: string }>(ctx, sql`SELECT id FROM lead_handover WHERE organization_id = ${ctx.organizationId} AND lead_id = ${leadId} AND status = 'pending'`); return row !== null; }
export async function listHandovers(ctx: RequestContext, filter: SqlFragment): Promise<Handover[]> { const rows = await db.query<Handover>(ctx, sql`${HANDOVER_SELECT} WHERE h.organization_id = ${ctx.organizationId} AND ${filter} ORDER BY h.offered_at DESC`); return rows.map(mapHandover); }
export async function loadHandoverResource(ctx: RequestContext, id: string) {
  return db.maybeOne<{ id: string; organizationId: string; leadId: string; fromUserId: string; toUserId: string | null; status: string; handoverMode: 'direct' | 'team_queue'; disposition: string | null; ownerId: string | null; currentHolderId: string | null; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null }>(ctx, sql`
    SELECT h.id, h.organization_id AS "organizationId", h.lead_id AS "leadId", h.from_user_id AS "fromUserId", h.to_user_id AS "toUserId", h.status, h.handover_mode AS "handoverMode", h.disposition,
           l.owner_id AS "ownerId", l.current_holder_id AS "currentHolderId", l.sales_team_id AS "salesTeamId", l.sales_pool_id AS "salesPoolId", team.department_id AS "departmentId"
    FROM lead_handover h JOIN lead l ON l.organization_id = h.organization_id AND l.id = h.lead_id
    LEFT JOIN team ON team.organization_id = l.organization_id AND team.id = l.sales_team_id
    WHERE h.organization_id = ${ctx.organizationId} AND h.id = ${id}
  `).then((row) => row ? { type: 'handover' as const, ...row } : null);
}

export async function findLeadHandoverResource(ctx: RequestContext, leadId: string) {
  return db.maybeOne<{ id: string; organizationId: string; ownerId: string | null; currentHolderId: string | null; status: string; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null }>(ctx, sql`SELECT l.id, l.organization_id AS "organizationId", l.owner_id AS "ownerId", l.current_holder_id AS "currentHolderId", l.status, l.sales_team_id AS "salesTeamId", l.sales_pool_id AS "salesPoolId", team.department_id AS "departmentId" FROM lead l LEFT JOIN team ON team.organization_id = l.organization_id AND team.id = l.sales_team_id WHERE l.organization_id = ${ctx.organizationId} AND l.id = ${leadId}`).then((row) => row ? { type: 'lead' as const, ...row } : null);
}

const handoverTargetSelect = (organizationId: string) => sql`
    SELECT u.id, u.full_name AS "fullName", p.code AS "positionCode", u.team_id AS "teamId",
           'not_punched_in'::text AS availability, false AS selectable,
           (SELECT COUNT(*)::int FROM lead_handover accepted
            WHERE accepted.organization_id = u.organization_id AND accepted.to_user_id = u.id
              AND accepted.status = 'accepted' AND accepted.accepted_at >= now() - interval '1 hour') AS "acceptedLastHour"
    FROM app_user u
    JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id AND d.code = 'sales' AND d.status = 'active'
    JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id AND p.code IN ('sales-supervisor', 'sales-team-lead') AND p.status = 'active'
    WHERE u.organization_id = ${organizationId} AND u.account_type = 'employee' AND u.status = 'active'
      AND EXISTS (SELECT 1 FROM position_policy pp WHERE pp.organization_id = u.organization_id AND pp.position_id = u.position_id AND pp.action = 'handovers:receive' AND pp.allowed = true)
      AND NOT EXISTS (SELECT 1 FROM user_override denied WHERE denied.organization_id = u.organization_id AND denied.user_id = u.id AND denied.action = 'handovers:receive' AND denied.allowed = false AND denied.revoked_at IS NULL AND (denied.expires_at IS NULL OR denied.expires_at > now()))
`;

export async function listHandoverTargets(ctx: RequestContext): Promise<HandoverTarget[]> {
  const rows = await db.query<HandoverTarget>(ctx, sql`${handoverTargetSelect(ctx.organizationId)} ORDER BY selectable DESC, CASE availability WHEN 'working' THEN 0 WHEN 'on_break' THEN 1 ELSE 2 END, "acceptedLastHour" DESC, CASE WHEN "positionCode" = 'sales-supervisor' THEN 0 ELSE 1 END, "fullName"`);
  return rows;
}

export async function loadSelectableHandoverTargetTx(tx: Tx, organizationId: string, userId: string): Promise<HandoverTarget | null> {
  const rows = await tx.query<HandoverTarget>(sql`SELECT * FROM (${handoverTargetSelect(organizationId)}) eligible WHERE eligible.id = ${userId} AND eligible.selectable = true`);
  return rows[0] ?? null;
}

export async function insertHandover(tx: Tx, organizationId: string, input: { leadId: string; fromUserId: string; toUserId: string | null; handoverMode: 'direct' | 'team_queue'; reason: string | null; annotations: unknown }): Promise<string> { const row = await tx.one<{ id: string }>(sql`INSERT INTO lead_handover (organization_id, lead_id, from_user_id, to_user_id, handover_mode, reason, annotations) VALUES (${organizationId}, ${input.leadId}, ${input.fromUserId}, ${input.toUserId}, ${input.handoverMode}, ${input.reason}, ${JSON.stringify(input.annotations ?? {})}::jsonb) RETURNING id`); return row.id; }
export async function expirePendingHandovers(tx: Tx, organizationId: string, expiryMinutes: number): Promise<Array<{ id: string; leadId: string; toUserId: string | null }>> { return tx.query<{ id: string; leadId: string; toUserId: string | null }>(sql`UPDATE lead_handover SET status = 'expired', expired_at = now(), time_to_outcome_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::integer WHERE organization_id = ${organizationId} AND status = 'pending' AND offered_at < now() - (${expiryMinutes} * interval '1 minute') RETURNING id, lead_id AS "leadId", to_user_id AS "toUserId"`); }
export async function acceptHandover(tx: Tx, organizationId: string, id: string): Promise<boolean> { const rows = await tx.query<{ id: string }>(sql`UPDATE lead_handover SET status = 'accepted', accepted_at = now(), time_to_accept_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::integer WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'pending' RETURNING id`); return rows.length > 0; }
export async function claimQueuedHandover(tx: Tx, organizationId: string, id: string, userId: string): Promise<boolean> { const rows = await tx.query<{ id: string }>(sql`UPDATE lead_handover SET to_user_id = ${userId}, status = 'accepted', accepted_at = now(), queue_claimed_at = now(), time_to_accept_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::integer WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'pending' AND handover_mode = 'team_queue' AND to_user_id IS NULL RETURNING id`); return rows.length > 0; }
export async function declineHandover(tx: Tx, organizationId: string, id: string, reason: string): Promise<boolean> { const rows = await tx.query<{ id: string }>(sql`UPDATE lead_handover SET status = 'declined', declined_at = now(), time_to_outcome_seconds = EXTRACT(EPOCH FROM (now() - offered_at))::integer, reason = ${reason} WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'pending' RETURNING id`); return rows.length > 0; }
export async function recordHandoverDisposition(tx: Tx, organizationId: string, id: string, disposition: string, reason: string | null, annotations: unknown): Promise<boolean> { const rows = await tx.query<{ id: string }>(sql`UPDATE lead_handover SET disposition = ${disposition}, disposition_at = now(), time_to_outcome_seconds = EXTRACT(EPOCH FROM (now() - COALESCE(accepted_at, offered_at)))::integer, reason = COALESCE(${reason}, reason), annotations = annotations || ${JSON.stringify(annotations ?? {})}::jsonb WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'accepted' AND disposition IS NULL RETURNING id`); return rows.length > 0; }
export async function insertHandoverAnnotation(tx: Tx, organizationId: string, handoverId: string, authorId: string, annotation: string): Promise<void> { await tx.query(sql`INSERT INTO lead_handover_annotation (organization_id, handover_id, author_id, annotation) SELECT ${organizationId}, h.id, ${authorId}, ${annotation} FROM lead_handover h WHERE h.organization_id = ${organizationId} AND h.id = ${handoverId}`); }
