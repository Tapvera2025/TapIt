/**
 * Pure helpers for the bid-pool UI (R1 plan step 1.13). Split from
 * React so the aging + cooling + collision math is unit-testable.
 */

export const PASS_COOLING_MINUTES = 5;

export interface AgingResult {
  readonly secondsRemaining: number;
  readonly severity: 'fresh' | 'warming' | 'hot' | 'expired';
  readonly label: string;
}

/**
 * Returns an aging bucket based on the pool's 10-minute window:
 *   > 7 min remaining  → fresh
 *   > 3 min            → warming
 *   > 0                → hot
 *   <= 0               → expired (the server sweep will remove it next tick)
 */
export function describeAging(expiresAtIso: string, now: Date = new Date()): AgingResult {
  const expires = new Date(expiresAtIso).getTime();
  const secondsRemaining = Math.max(0, Math.round((expires - now.getTime()) / 1000));
  if (secondsRemaining > 7 * 60) return { secondsRemaining, severity: 'fresh', label: formatRemaining(secondsRemaining) };
  if (secondsRemaining > 3 * 60) return { secondsRemaining, severity: 'warming', label: formatRemaining(secondsRemaining) };
  if (secondsRemaining > 0) return { secondsRemaining, severity: 'hot', label: formatRemaining(secondsRemaining) };
  return { secondsRemaining: 0, severity: 'expired', label: 'expired' };
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}:${rem.toString().padStart(2, '0')}`;
}

/**
 * Local pass-cooling tracker. The server also enforces 5-minute cooling
 * via `bid_pool_view.pass_until`, but we want the UI to hide the card
 * immediately on Pass without waiting for the realtime echo.
 */
export class PassCooldown {
  private readonly timers = new Map<string, number>();
  passUntil(leadId: string, nowMs: number = Date.now()): number {
    const until = nowMs + PASS_COOLING_MINUTES * 60_000;
    this.timers.set(leadId, until);
    return until;
  }
  isCoolingDown(leadId: string, nowMs: number = Date.now()): boolean {
    const until = this.timers.get(leadId);
    if (until === undefined) return false;
    if (until <= nowMs) {
      this.timers.delete(leadId);
      return false;
    }
    return true;
  }
  reset(): void { this.timers.clear(); }
  size(): number { return this.timers.size; }
}

export type PassReason = 'wrong_location' | 'out_of_expertise' | 'at_capacity' | 'other';
export const PASS_REASONS: ReadonlyArray<{ value: PassReason; label: string }> = [
  { value: 'wrong_location', label: 'Wrong location' },
  { value: 'out_of_expertise', label: 'Out of expertise' },
  { value: 'at_capacity', label: 'At capacity' },
  { value: 'other', label: 'Other' },
];

/** Deduplicate + chronological order (newest first) when applying a realtime add. */
export function prependCard<T extends { leadId: string }>(cards: readonly T[], card: T): T[] {
  const filtered = cards.filter((c) => c.leadId !== card.leadId);
  return [card, ...filtered];
}

export function removeCard<T extends { leadId: string }>(cards: readonly T[], leadId: string): T[] {
  return cards.filter((c) => c.leadId !== leadId);
}

/**
 * Classify an HTTP error. The claim endpoint returns 409 ALREADY_CLAIMED
 * on a race — we treat that distinctly from a generic failure because
 * the UI shows a specific "someone else got it" toast.
 */
export type ClaimError = 'already_claimed' | 'not_eligible' | 'other';
export function classifyClaimError(status: number, body: unknown): ClaimError {
  if (status === 409) return 'already_claimed';
  if (status === 422) return 'not_eligible';
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const code = (body as { code?: unknown }).code;
    if (code === 'ALREADY_CLAIMED') return 'already_claimed';
    if (code === 'NOT_ELIGIBLE') return 'not_eligible';
  }
  return 'other';
}
