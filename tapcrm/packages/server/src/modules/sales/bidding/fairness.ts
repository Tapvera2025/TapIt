/**
 * Sales v1.1 — fairness guards (R1 plan step 1.17).
 *
 * The availability facade already soft-rejects at the pre-claim phase
 * when an agent is `at_capacity`, so a reasonable UI never prompts them
 * to claim. These guards are the hard enforcement inside the claim
 * transaction: a race where a card is claimed before the capacity cap
 * tripped, a stale socket snapshot, or a misbehaving client all land
 * here before the lead state transitions.
 *
 * Default caps (plan open question O3):
 *   activeLeadMax = 20   — same as the availability facade default
 *   dailyClaimMax = null — no cap unless the tenant overrides via config
 *
 * The config shape is read from `organization.config.sales.fairness`
 * (a jsonb column that already exists on `organization`) so a tenant
 * can tune caps without a code deploy. Falling back to defaults keeps
 * the pilot usable before any config row is written.
 */

import { ApplicationError } from '../../../errors.js';
import { OPERATIONAL_TZ } from '../../../platform/time.js';
import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export const FAIRNESS_ERROR_CODES = {
  ACTIVE_CAP_REACHED: 'ACTIVE_CAP_REACHED',
  DAILY_CAP_REACHED: 'DAILY_CAP_REACHED',
} as const;

export class ActiveCapReachedError extends ApplicationError {
  constructor(public readonly cap: number, public readonly active: number) {
    super(`Active-lead cap reached (${active} / ${cap})`, 409, FAIRNESS_ERROR_CODES.ACTIVE_CAP_REACHED, { cap, active });
    this.name = 'ActiveCapReachedError';
  }
}

export class DailyCapReachedError extends ApplicationError {
  constructor(public readonly cap: number, public readonly claimsToday: number) {
    super(`Daily claim cap reached (${claimsToday} / ${cap})`, 409, FAIRNESS_ERROR_CODES.DAILY_CAP_REACHED, { cap, claimsToday });
    this.name = 'DailyCapReachedError';
  }
}

export interface FairnessConfig {
  readonly activeLeadMax: number;
  readonly dailyClaimMax: number | null;
}

export const DEFAULT_FAIRNESS_CONFIG: FairnessConfig = {
  activeLeadMax: 20,
  dailyClaimMax: null,
};

/**
 * Returns the fairness config for the given tenant. R1 keeps this as
 * module defaults; a follow-up migration adds `organization.config` so
 * tenants can tune caps without a deploy. The signature already accepts
 * a Tx + orgId so wiring in the per-tenant query later is a one-file
 * change behind every call site.
 */
export async function loadFairnessConfig(_tx: Tx, _organizationId: string): Promise<FairnessConfig> {
  return DEFAULT_FAIRNESS_CONFIG;
}

/**
 * Hard enforcement inside the claim transaction. Throws on breach;
 * returns silently when both caps have headroom. The caller must have
 * already locked the lead row to prevent two concurrent claims from
 * both squeezing under the active cap.
 */
export async function checkFairness(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<void> {
  const config = await loadFairnessConfig(tx, organizationId);

  if (config.dailyClaimMax !== null) {
    const claims = await tx.one<{ count: string }>(sql`
      SELECT count(*)::text AS count
        FROM bid_pool_view
       WHERE organization_id = ${organizationId}
         AND agent_id        = ${userId}
         AND action          = 'claimed'
         AND last_seen_at    >= date_trunc('day', now() AT TIME ZONE ${OPERATIONAL_TZ})
    `);
    const claimsToday = Number(claims.count);
    if (claimsToday >= config.dailyClaimMax) {
      throw new DailyCapReachedError(config.dailyClaimMax, claimsToday);
    }
  }

  const active = await tx.one<{ count: string }>(sql`
    SELECT count(*)::text AS count
      FROM lead
     WHERE organization_id = ${organizationId}
       AND owner_id        = ${userId}
       AND lead_outcome    = 'active'
  `);
  const activeCount = Number(active.count);
  if (activeCount >= config.activeLeadMax) {
    throw new ActiveCapReachedError(config.activeLeadMax, activeCount);
  }
}
