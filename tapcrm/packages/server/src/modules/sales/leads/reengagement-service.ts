import { visibilityFilter } from '@tapcrm/authz';
import type { SqlFragment } from '@tapcrm/authz';
import { db } from '../../../platform/dal/db.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { sql } from '../../../platform/dal/sql.js';
import { insertAudit } from './repository.js';

export interface ReengagementQuery {
  lossReason?: string | undefined;
  sourceId?: string | undefined;
  campaignId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export async function listReengagementSegments(ctx: RequestContext, query: ReengagementQuery) {
  const visibility = await visibilityFilter(ctx, 'leads:view', 'lead');
  const filters: SqlFragment[] = [visibility, sql`l.status = 'closed_lost'`, sql`l.lost_at IS NOT NULL`];
  if (query.lossReason) filters.push(sql`l.loss_reason = ${query.lossReason}`);
  if (query.sourceId) filters.push(sql`l.source_id = ${query.sourceId}`);
  if (query.campaignId) filters.push(sql`l.campaign_id = ${query.campaignId}`);
  if (query.from) filters.push(sql`l.lost_at >= ${query.from}`);
  if (query.to) filters.push(sql`l.lost_at < ${query.to}`);
  const filter = sql.join(filters, ' AND ');
  const rows = await db.query<{ sourceName: string; campaignName: string | null; lossReason: string; lostDate: string; count: number }>(ctx, sql`SELECT source.name AS "sourceName", campaign.name AS "campaignName", l.loss_reason AS "lossReason", date_trunc('day', l.lost_at)::date::text AS "lostDate", COUNT(*)::int AS count FROM lead l JOIN lead_source source ON source.organization_id = l.organization_id AND source.id = l.source_id LEFT JOIN campaign ON campaign.organization_id = l.organization_id AND campaign.id = l.campaign_id WHERE l.organization_id = ${ctx.organizationId} AND ${filter} GROUP BY source.name, campaign.name, l.loss_reason, date_trunc('day', l.lost_at)::date ORDER BY "lostDate" DESC, "sourceName", "campaignName"`);
  await db.transaction(ctx, async (tx) => insertAudit(tx, ctx, 'reengagement.segments.viewed', ctx.organizationId, null, { segmentCount: rows.length }, 'reengagement_segment'));
  return { filters: query, total: rows.reduce((sum, row) => sum + Number(row.count), 0), segments: rows.map((row) => ({ ...row, count: Number(row.count) })) };
}
