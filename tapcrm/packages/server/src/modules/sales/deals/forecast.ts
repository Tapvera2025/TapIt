/**
 * Sales v1.1 — Forecast / reporting endpoint (R4/R5 preview).
 *
 * One endpoint declared in the authorization manifest at
 * `GET /api/deals/forecast` with action `deals:forecast`. The handler
 * returns a period-scoped aggregate the Reports page renders:
 *   - funnel         : counts per deal_stage (open deals only)
 *   - lifecycle      : counts per lifecycle_status within the period
 *   - lossReasons    : counts per structured loss reason within the period
 *   - winLeaderboard : won amount per responsible closer, joined to the
 *                      active commercials version's total_minor
 *   - totals         : period summary (won count, won amount, lost count)
 *
 * All queries are gated by `deals:view` visibility so a non-manager who
 * somehow holds `deals:forecast` can only see their own slice.
 */

import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { DEAL_LOSS_REASONS, DEAL_STAGES, type DealLossReason, type DealStage } from './types.js';

export interface ForecastQuery {
  /** First instant of the period (inclusive). */
  readonly periodStart: Date;
  /** First instant AFTER the period (exclusive). */
  readonly periodEnd: Date;
}

export interface FunnelBucket {
  readonly stage: DealStage;
  readonly count: number;
}

export interface LifecycleBucket {
  readonly lifecycleStatus: 'open' | 'won' | 'lost' | 'cancelled';
  readonly count: number;
}

export interface LossReasonBucket {
  readonly reason: DealLossReason;
  readonly count: number;
}

export interface LeaderboardEntry {
  readonly responsibleCloserId: string;
  readonly responsibleCloserName: string | null;
  readonly wonCount: number;
  readonly wonAmountMinor: string;
  readonly currency: string;
}

export interface ForecastReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly funnel: readonly FunnelBucket[];
  readonly lifecycle: readonly LifecycleBucket[];
  readonly lossReasons: readonly LossReasonBucket[];
  readonly winLeaderboard: readonly LeaderboardEntry[];
  readonly totals: {
    readonly wonCount: number;
    readonly wonAmountMinor: string;
    readonly lostCount: number;
    readonly openCount: number;
  };
}

export async function buildForecast(ctx: RequestContext, query: ForecastQuery): Promise<ForecastReport> {
  const scope = await visibilityFilter(ctx, 'deals:view', 'deal');

  // Funnel: open deals snapshot (not period-bounded — a stage count is
  // meaningful "right now", not "in October").
  const funnelRows = await db.query<{ stage: DealStage; count: string }>(
    ctx,
    sql`SELECT d.deal_stage AS stage, count(*)::text AS count
          FROM deal d
         WHERE d.organization_id = ${ctx.organizationId}
           AND d.lifecycle_status = 'open'
           AND ${scope}
         GROUP BY d.deal_stage`,
  );
  const funnelMap = new Map(funnelRows.map((r) => [r.stage, Number(r.count)]));
  const funnel: FunnelBucket[] = DEAL_STAGES
    .filter((s) => s !== 'closed')
    .map((stage) => ({ stage, count: funnelMap.get(stage) ?? 0 }));

  // Lifecycle within period — a won/lost/cancelled deal is counted when
  // the terminal event lands inside the window; open deals are counted
  // when they were CREATED in the window (open deals have no terminal
  // timestamp to anchor the period against).
  const lifecycleRows = await db.query<{
    lifecycleStatus: 'open' | 'won' | 'lost' | 'cancelled';
    count: string;
  }>(
    ctx,
    sql`SELECT lifecycle_status AS "lifecycleStatus", count(*)::text AS count
          FROM deal d
         WHERE d.organization_id = ${ctx.organizationId}
           AND ${scope}
           AND (
             (d.lifecycle_status = 'won'       AND d.won_at       >= ${query.periodStart} AND d.won_at       < ${query.periodEnd})
             OR (d.lifecycle_status = 'lost'      AND d.lost_at      >= ${query.periodStart} AND d.lost_at      < ${query.periodEnd})
             OR (d.lifecycle_status = 'cancelled' AND d.cancelled_at >= ${query.periodStart} AND d.cancelled_at < ${query.periodEnd})
             OR (d.lifecycle_status = 'open'      AND d.created_at   >= ${query.periodStart} AND d.created_at   < ${query.periodEnd})
           )
         GROUP BY lifecycle_status`,
  );
  const lifecycle: LifecycleBucket[] = (['open', 'won', 'lost', 'cancelled'] as const).map(
    (status) => ({
      lifecycleStatus: status,
      count: Number(lifecycleRows.find((r) => r.lifecycleStatus === status)?.count ?? '0'),
    }),
  );

  // Loss reasons for deals lost in the period.
  const lossRows = await db.query<{ reason: DealLossReason; count: string }>(
    ctx,
    sql`SELECT loss_reason AS reason, count(*)::text AS count
          FROM deal d
         WHERE d.organization_id = ${ctx.organizationId}
           AND d.lifecycle_status = 'lost'
           AND d.lost_at >= ${query.periodStart}
           AND d.lost_at < ${query.periodEnd}
           AND d.loss_reason IS NOT NULL
           AND ${scope}
         GROUP BY loss_reason`,
  );
  const lossReasons: LossReasonBucket[] = DEAL_LOSS_REASONS
    .map((reason) => ({
      reason,
      count: Number(lossRows.find((r) => r.reason === reason)?.count ?? '0'),
    }))
    .filter((bucket) => bucket.count > 0);

  // Leaderboard: joined to the active commercials version. Deals won
  // without an active commercials version are counted but contribute 0
  // to the amount — that is a real pipeline state (direct-entry wins).
  const leaderboardRows = await db.query<{
    responsibleCloserId: string;
    responsibleCloserName: string | null;
    wonCount: string;
    wonAmountMinor: string | null;
    currency: string | null;
  }>(
    ctx,
    sql`SELECT d.responsible_closer_id AS "responsibleCloserId",
               u.full_name             AS "responsibleCloserName",
               count(*)::text          AS "wonCount",
               coalesce(sum(c.total_minor), 0)::text AS "wonAmountMinor",
               max(d.currency)         AS currency
          FROM deal d
          JOIN app_user u ON u.organization_id = d.organization_id AND u.id = d.responsible_closer_id
          LEFT JOIN commercials c ON c.organization_id = d.organization_id AND c.id = d.commercials_id
         WHERE d.organization_id = ${ctx.organizationId}
           AND d.lifecycle_status = 'won'
           AND d.won_at >= ${query.periodStart}
           AND d.won_at < ${query.periodEnd}
           AND ${scope}
         GROUP BY d.responsible_closer_id, u.full_name
         ORDER BY sum(c.total_minor) DESC NULLS LAST, count(*) DESC
         LIMIT 50`,
  );
  const winLeaderboard: LeaderboardEntry[] = leaderboardRows.map((row) => ({
    responsibleCloserId: row.responsibleCloserId,
    responsibleCloserName: row.responsibleCloserName,
    wonCount: Number(row.wonCount),
    wonAmountMinor: row.wonAmountMinor ?? '0',
    currency: row.currency ?? 'INR',
  }));

  // Totals rolled up from lifecycle + leaderboard.
  const totals = {
    wonCount: lifecycle.find((b) => b.lifecycleStatus === 'won')?.count ?? 0,
    lostCount: lifecycle.find((b) => b.lifecycleStatus === 'lost')?.count ?? 0,
    openCount: funnel.reduce((sum, b) => sum + b.count, 0),
    wonAmountMinor: winLeaderboard
      .reduce((sum, entry) => sum + BigInt(entry.wonAmountMinor), 0n)
      .toString(),
  };

  return {
    periodStart: query.periodStart.toISOString(),
    periodEnd: query.periodEnd.toISOString(),
    funnel,
    lifecycle,
    lossReasons,
    winLeaderboard,
    totals,
  };
}
