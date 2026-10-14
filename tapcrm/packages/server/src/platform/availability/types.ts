/**
 * Sales v1.1 — availability facade types (PRD R-ROUTE-03, R-ROUTE-07).
 *
 * The facade asks one question in one query: "is this user eligible to be
 * assigned a new sales lead right now?" It reads from the `user_status`
 * projection (presence, break, leave day-group, shift window) joined with
 * live counts of active leads and today's bid-pool claims.
 */

export type EligibilityReason =
  | 'not_active'            // user is inactive or archived
  | 'not_punched_in'        // user_status.state is not WORKING/ON_BREAK
  | 'on_break'              // user_status.state = ON_BREAK
  | 'on_leave'              // user_status.day_group = 'leave'
  | 'on_holiday'            // user_status.day_group = 'holiday'
  | 'outside_shift'         // outside of shift_start_at … shift_end_at
  | 'at_capacity'           // open leads >= activeLeadMax
  | 'cooling_period'        // currently covered by a recent pass; service-layer concern
  | 'daily_cap_hit'         // today's claims >= dailyClaimMax
  | 'service_unavailable';  // dependency query failed; FAIL CLOSED

export interface AvailabilityResult {
  readonly userId: string;
  readonly eligible: boolean;
  readonly reasons: readonly EligibilityReason[];
  readonly activeLeadCount: number;
  readonly claimsToday: number;
}

export interface AvailabilityCaps {
  /** PRD R-FAIR-02 default; configurable per tenant (O3). */
  readonly activeLeadMax?: number;
  /** PRD R-FAIR-01 default null (no cap in pilot); configurable (O3). */
  readonly dailyClaimMax?: number | null;
  /**
   * When true, require the current instant to fall inside the user's
   * recorded shift window on `user_status`. Default false — presence
   * is enough for the bidding pool, since the service accepts anyone
   * actively punched in regardless of shift boundary.
   */
  readonly requireInsideShift?: boolean;
}

export interface AvailabilityOptions {
  readonly pool?: 'bidding' | 'direct' | 'handover';
  readonly caps?: AvailabilityCaps;
}

export const DEFAULT_ACTIVE_LEAD_MAX = 20;
