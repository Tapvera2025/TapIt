/**
 * Sales v1.1 — per-agent workload snapshot used by the direct-assignment
 * router (R1 plan step 1.4).
 *
 *   workload(user) = activeLeadCount + overdueWeight * overdueCallbackCount
 *
 * "Active lead" = `lead.lead_outcome = 'active'` and `lead.owner_id = user`.
 * "Overdue callback" = `lead_callback.status = 'scheduled'` and the
 * scheduled instant has already passed. The weight is a routing input; the
 * aggregation here is unweighted so the router can tune it per call.
 */

import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';

export interface AgentWorkload {
  readonly userId: string;
  readonly activeLeadCount: number;
  readonly overdueCallbackCount: number;
}

export async function fetchWorkload(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
): Promise<AgentWorkload[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.query<{
    userId: string;
    activeLeadCount: string;
    overdueCallbackCount: string;
  }>(sql`
    SELECT u.id                                 AS "userId",
           COALESCE(l.active_count, 0)::text    AS "activeLeadCount",
           COALESCE(c.overdue_count, 0)::text   AS "overdueCallbackCount"
      FROM unnest(${userIds as unknown as string[]}::uuid[]) AS u(id)
      LEFT JOIN LATERAL (
        SELECT count(*) AS active_count
          FROM lead
         WHERE lead.organization_id = ${organizationId}
           AND lead.owner_id        = u.id
           AND lead.lead_outcome    = 'active'
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS overdue_count
          FROM lead_callback
         WHERE lead_callback.organization_id = ${organizationId}
           AND lead_callback.owner_id        = u.id
           AND lead_callback.status          = 'scheduled'
           AND lead_callback.scheduled_at    < now()
      ) c ON true
  `);
  return rows.map((r) => ({
    userId: r.userId,
    activeLeadCount: Number(r.activeLeadCount),
    overdueCallbackCount: Number(r.overdueCallbackCount),
  }));
}
