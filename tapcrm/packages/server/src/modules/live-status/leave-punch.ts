/**
 * Whether approved leave stops a punch in on a day.
 *
 * Full-day leave does: there is no work to record. Half-day leave (first or
 * second half) does not: the person works the other half, and attendance's
 * day calculation counts that time for the half that is not on leave
 * (status `half-day-leave`). Refusing the punch left that half absent.
 *
 * Any leave kind other than the two halves counts as a full day, so an
 * unexpected kind refuses the punch rather than allowing it.
 */
const HALF_DAY_LEAVE_KINDS: ReadonlySet<string> = new Set(['leave-first-half', 'leave-second-half']);

export function leaveBlocksPunchIn(
  overlays: readonly { readonly sourceKind: string; readonly kind: string }[],
): boolean {
  return overlays.some(
    (overlay) => overlay.sourceKind === 'leave' && !HALF_DAY_LEAVE_KINDS.has(overlay.kind),
  );
}
