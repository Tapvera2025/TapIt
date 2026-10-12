/**
 * Sales v1.1 — supervisor dashboard queries (R1 plan step 1.17).
 *
 *   claimsDistribution → per-agent claims-today count, sorted DESC.
 *                        Visible to roles holding `leads:view` at pool
 *                        scope or wider (handled by the route action).
 *   poolHealth         → counts of bid_state over the last 24h plus
 *                        current open / triaged inventory.
 */

import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { OPERATIONAL_TZ } from '../../../platform/time.js';
import { sql } from '../../../platform/dal/sql.js';

export interface ClaimsDistributionRow {
  readonly userId: string;
  readonly fullName: string;
  readonly claimsToday: number;
  readonly activeLeads: number;
}

export async function claimsDistribution(ctx: RequestContext): Promise<ClaimsDistributionRow[]> {
  const rows = await db.query<{
    userId: string;
    fullName: string;
    claimsToday: string;
    activeLeads: string;
  }>(
    ctx,
    sql`
      SELECT u.id                                      AS "userId",
             u.full_name                               AS "fullName",
             COALESCE(c.claims_today, 0)::text         AS "claimsToday",
             COALESCE(l.active_count, 0)::text         AS "activeLeads"
        FROM app_user u
        LEFT JOIN LATERAL (
          SELECT count(*) AS claims_today
            FROM bid_pool_view bpv
           WHERE bpv.organization_id = u.organization_id
             AND bpv.agent_id        = u.id
             AND bpv.action          = 'claimed'
             AND bpv.last_seen_at    >= date_trunc('day', now() AT TIME ZONE ${OPERATIONAL_TZ})
        ) c ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS active_count
            FROM lead l
           WHERE l.organization_id = u.organization_id
             AND l.owner_id        = u.id
             AND l.lead_outcome    = 'active'
        ) l ON true
       WHERE u.organization_id = ${ctx.organizationId}
         AND u.account_type    = 'employee'
         AND u.status          = 'active'
       ORDER BY COALESCE(c.claims_today, 0) DESC, u.full_name ASC
       LIMIT 100
    `,
  );
  return rows.map((row) => ({
    userId: row.userId,
    fullName: row.fullName,
    claimsToday: Number(row.claimsToday),
    activeLeads: Number(row.activeLeads),
  }));
}

export interface PoolHealthSnapshot {
  readonly openNow: number;
  readonly triageNow: number;
  readonly claimed24h: number;
  readonly fallback24h: number;
  readonly triaged24h: number;
  readonly timeoutRate: number;
}

export async function poolHealth(ctx: RequestContext): Promise<PoolHealthSnapshot> {
  const row = await db.one<{
    openNow: string;
    triageNow: string;
    claimed24h: string;
    fallback24h: string;
    triaged24h: string;
  }>(
    ctx,
    sql`
      SELECT
        (SELECT count(*) FROM lead
          WHERE organization_id = ${ctx.organizationId}
            AND bid_state       = 'pool_open'
        )::text AS "openNow",
        (SELECT count(*) FROM lead
          WHERE organization_id = ${ctx.organizationId}
            AND bid_state       = 'triage'
        )::text AS "triageNow",
        (SELECT count(*) FROM sales_routing_decision
          WHERE organization_id = ${ctx.organizationId}
            AND mode            = 'bidding'
            AND reason          = 'claim'
            AND created_at      >= now() - interval '24 hours'
        )::text AS "claimed24h",
        (SELECT count(*) FROM sales_routing_decision
          WHERE organization_id = ${ctx.organizationId}
            AND mode            = 'fallback'
            AND reason LIKE 'bid_pool_timeout_fallback%'
            AND created_at      >= now() - interval '24 hours'
        )::text AS "fallback24h",
        (SELECT count(*) FROM sales_routing_decision
          WHERE organization_id = ${ctx.organizationId}
            AND mode            = 'fallback'
            AND reason LIKE 'bid_pool_timeout_no_fallback%'
            AND created_at      >= now() - interval '24 hours'
        )::text AS "triaged24h"
    `,
  );
  const claimed = Number(row.claimed24h);
  const fallback = Number(row.fallback24h);
  const triaged = Number(row.triaged24h);
  const total = claimed + fallback + triaged;
  const timeoutRate = total === 0 ? 0 : Math.round(((fallback + triaged) / total) * 1000) / 10;
  return {
    openNow: Number(row.openNow),
    triageNow: Number(row.triageNow),
    claimed24h: claimed,
    fallback24h: fallback,
    triaged24h: triaged,
    timeoutRate,
  };
}
