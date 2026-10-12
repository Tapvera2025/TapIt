/**
 * Sales v1.1 — availability facade service (PRD R-ROUTE-03, R-ROUTE-07).
 *
 * The sole public entry point used by:
 *   - the bidding pool (filters the eligible-agents snapshot when a lead
 *     enters the pool and when a claim is attempted)
 *   - the direct-assignment router (filters candidates for fewest-open-leads)
 *   - the reassignment flow (soft-warns the HOD if the new owner is
 *     ineligible)
 *
 * Fail-closed: if the dependency query errors, every requested user is
 * returned ineligible with reason `service_unavailable`. This matches the
 * PRD rule that "stale or unavailable status is not assumed working".
 */

import type { RequestContext } from '../dal/context.js';
import { db } from '../dal/db.js';
import { sql } from '../dal/sql.js';
import { OPERATIONAL_TZ } from '../time.js';
import {
  DEFAULT_ACTIVE_LEAD_MAX,
  type AvailabilityOptions,
  type AvailabilityResult,
  type EligibilityReason,
} from './types.js';

interface Row {
  userId: string;
  isActive: boolean;
  presenceState: 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'FINISHED' | null;
  dayGroup: 'leave' | 'holiday' | null;
  shiftStartAt: Date | null;
  shiftEndAt: Date | null;
  activeLeadCount: string;
  claimsToday: string;
}

export async function evaluateAvailability(
  ctx: RequestContext,
  userIds: readonly string[],
  opts: AvailabilityOptions = {},
): Promise<AvailabilityResult[]> {
  if (userIds.length === 0) return [];

  const caps = opts.caps ?? {};
  const activeLeadMax = caps.activeLeadMax ?? DEFAULT_ACTIVE_LEAD_MAX;
  const dailyClaimMax = caps.dailyClaimMax ?? null;
  const requireInsideShift = caps.requireInsideShift ?? false;

  let rows: Row[];
  try {
    rows = await db.query<Row>(
      ctx,
      sql`
        SELECT
          u.id                                                 AS "userId",
          u.status = 'active'                                  AS "isActive",
          us.state                                             AS "presenceState",
          us.day_group                                         AS "dayGroup",
          us.shift_start_at                                    AS "shiftStartAt",
          us.shift_end_at                                      AS "shiftEndAt",
          COALESCE(l.active_count, 0)::text                    AS "activeLeadCount",
          COALESCE(c.claims_today, 0)::text                    AS "claimsToday"
        FROM app_user u
        LEFT JOIN user_status us
          ON us.organization_id = u.organization_id
         AND us.user_id         = u.id
         AND us.work_date       = (now() AT TIME ZONE ${OPERATIONAL_TZ})::date
        LEFT JOIN LATERAL (
          SELECT count(*) AS active_count
            FROM lead
           WHERE lead.organization_id = u.organization_id
             AND lead.owner_id        = u.id
             AND lead.lead_outcome    = 'active'
        ) l ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS claims_today
            FROM bid_pool_view bpv
           WHERE bpv.organization_id = u.organization_id
             AND bpv.agent_id        = u.id
             AND bpv.action          = 'claimed'
             AND bpv.last_seen_at    >= date_trunc('day', now() AT TIME ZONE ${OPERATIONAL_TZ})
        ) c ON true
        WHERE u.organization_id = ${ctx.organizationId}
          AND u.id = ANY(${userIds as unknown as string[]}::uuid[])
      `,
    );
  } catch (err) {
    return userIds.map((userId) => failClosed(userId, err));
  }

  const byUserId = new Map(rows.map((r) => [r.userId, r]));
  const now = Date.now();

  return userIds.map<AvailabilityResult>((userId) => {
    const row = byUserId.get(userId);
    if (!row) {
      // User does not exist in this tenant, or was archived. Treat as
      // not-active; this is also what the FK check would say later.
      return {
        userId,
        eligible: false,
        reasons: ['not_active'],
        activeLeadCount: 0,
        claimsToday: 0,
      };
    }

    const reasons: EligibilityReason[] = [];

    if (!row.isActive) reasons.push('not_active');
    if (row.dayGroup === 'leave') reasons.push('on_leave');
    if (row.dayGroup === 'holiday') reasons.push('on_holiday');
    if (row.presenceState === 'ON_BREAK') reasons.push('on_break');
    if (
      row.presenceState !== 'WORKING' &&
      row.presenceState !== 'ON_BREAK' &&
      !reasons.includes('on_leave') &&
      !reasons.includes('on_holiday')
    ) {
      reasons.push('not_punched_in');
    }

    if (requireInsideShift && row.shiftStartAt && row.shiftEndAt) {
      if (now < row.shiftStartAt.getTime() || now > row.shiftEndAt.getTime()) {
        reasons.push('outside_shift');
      }
    }

    const active = Number(row.activeLeadCount);
    const claims = Number(row.claimsToday);
    if (active >= activeLeadMax) reasons.push('at_capacity');
    if (dailyClaimMax !== null && claims >= dailyClaimMax) reasons.push('daily_cap_hit');

    return {
      userId,
      eligible: reasons.length === 0,
      reasons,
      activeLeadCount: active,
      claimsToday: claims,
    };
  });
}

function failClosed(userId: string, err: unknown): AvailabilityResult {
  // Logged by the caller (service.ts emits a warn log; we return the shape).
  const _err = err;
  return {
    userId,
    eligible: false,
    reasons: ['service_unavailable'],
    activeLeadCount: 0,
    claimsToday: 0,
  };
}
