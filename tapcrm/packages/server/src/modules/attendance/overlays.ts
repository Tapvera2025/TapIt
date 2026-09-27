import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { systemClock, type Clock } from '../../platform/time.js';
import { ensureDayRecord } from './day-open.js';
import { currentDayFor } from './ledger.js';
import { presenceProjector } from './ports.js';
import * as repo from './repository.js';

/**
 * The overlay seam — the one entry point leave (step 6) and break-management
 * (step 8) use to affect an attendance day (L8, BM-5).
 *
 * `kind` uses the calculator's existing vocabulary from 3a/3b. Leaves come in
 * three shapes because §8.3 splits a fixed shift at its midpoint (LV-8), so
 * the calculator needs to know which half.
 *
 * `paid` and `consequence` / `minutes` are calculator inputs (§8.3, BM-5).
 * `paid` on leave decides whether the day's leave units are `paidLeave` or
 * `unpaidLeave`. `consequence` on a break breach tells the calculator to
 * mark-late / mark-half-day / mark-absent / deduct N minutes.
 *
 * `sourceKind` maps to the provenance column inside the repo — external
 * callers never see the split between `leave_request_id` and `break_breach_id`.
 */
export type OverlaySourceKind = 'leave' | 'wfh' | 'break-breach';

export interface OverlayInput {
  readonly sourceKind: OverlaySourceKind;
  readonly sourceId: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly kind:
    | 'leave-full'
    | 'leave-first-half'
    | 'leave-second-half'
    | 'wfh'
    | 'breach-consequence';
  /** Only meaningful when `kind` is a `leave-*`. */
  readonly paid?: boolean | null;
  /** Only meaningful when `kind === 'breach-consequence'`. */
  readonly consequence?:
    'mark-late' | 'mark-half-day' | 'mark-absent' | 'deduct-minutes' | null;
  /** Minutes to deduct, when `consequence === 'deduct-minutes'`. */
  readonly minutes?: number | null;
}

/**
 * Apply one overlay, in the caller's transaction (MB-2, TX-5): leave's
 * approval and its overlay commit together or not at all. Takes the
 * person's lock first (D24), ensures the day's record exists (without its
 * own event), writes the overlay, bumps the day's input version, and writes
 * exactly ONE `attendance.recalc-requested` for the combined change.
 *
 * If the same source+date+kind is applied twice, the second call is a no-op
 * (upsert by the schema's UNIQUE key). No bump, no event.
 */
export async function applyOverlay(
  tx: Tx,
  input: OverlayInput,
  clock: Clock = systemClock,
): Promise<void> {
  await repo.lockPerson(tx, input.userId);
  await ensureDayRecord(tx, input.userId, input.workDate, { emitRecalc: false });
  const organizationId = await repo.currentOrganizationId(tx);
  const inserted = await repo.upsertOverlay(tx, organizationId, {
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    userId: input.userId,
    workDate: input.workDate,
    kind: input.kind,
    paid: input.paid ?? null,
    consequence: input.consequence ?? null,
    minutes: input.minutes ?? null,
  });
  if (!inserted) return; // strict no-op on re-apply
  const record = await repo.findRecordByDate(tx, input.userId, input.workDate);
  // No record: the person is not employed on the date, so there is no day to judge.
  if (record === null) return;
  await repo.bumpInputVersions(tx, organizationId, input.userId, new Set([record.id]));
  // LS-4: refresh the live projection AFTER the overlay is written, and
  // only when the overlay's date is the person's current day. A future
  // leave writes the overlay and stops here; the live projection catches
  // up when that day becomes current.
  await maybeRefreshProjector(tx, input.userId, input.workDate, clock);
}

/**
 * Remove every overlay that came from the given source (a leave request
 * cancelled, say), in the caller's transaction. Each affected person's lock
 * is taken first, in a fixed order (D24); then each affected day gets a new
 * input version and one `attendance.recalc-requested`.
 */
export async function removeOverlays(
  tx: Tx,
  sourceKind: OverlaySourceKind,
  sourceId: string,
  clock: Clock = systemClock,
): Promise<void> {
  const people = await repo.overlayOwners(tx, sourceKind, sourceId);
  if (people.length === 0) return;
  for (const userId of people) await repo.lockPerson(tx, userId);
  const affected = await repo.deleteOverlaysBySource(tx, sourceKind, sourceId);
  const organizationId = await repo.currentOrganizationId(tx);
  for (const userId of people) {
    const ids = new Set<string>();
    for (const day of affected.filter((a) => a.userId === userId)) {
      const record = await repo.findRecordByDate(tx, userId, day.workDate);
      if (record !== null) ids.add(record.id);
    }
    await repo.bumpInputVersions(tx, organizationId, userId, ids);
    // LS-4: refresh the live projection once per person, but only if any
    // of their affected dates is their current day. `currentDayFor` reads
    // through today's shifts, so one call per person is enough — the
    // helper checks each affected date against it.
    for (const day of affected.filter((a) => a.userId === userId)) {
      await maybeRefreshProjector(tx, userId, day.workDate, clock);
    }
  }
}

/**
 * Remove one overlay for a specific source+date (WFH-7 partial displacement).
 * Acquires the person lock, removes the single row, bumps the record's
 * input_version, and refreshes the projector if the date is current.
 */
export async function removeOverlayForDate(
  tx: Tx,
  userId: string,
  sourceId: string,
  workDate: DateOnly,
  clock: Clock = systemClock,
): Promise<void> {
  await repo.lockPerson(tx, userId);
  const deleted = await repo.deleteOverlayBySourceAndDate(tx, sourceId, workDate);
  if (!deleted) return;
  const organizationId = await repo.currentOrganizationId(tx);
  const record = await repo.findRecordByDate(tx, userId, workDate);
  if (record !== null) {
    await repo.bumpInputVersions(tx, organizationId, userId, new Set([record.id]));
  }
  await maybeRefreshProjector(tx, userId, workDate, clock);
}

/**
 * Guarded projector refresh (§9.3, plan §4a/5a): only when `date` equals
 * the person's current day (per `currentDayFor(now)`). A future-dated
 * overlay writes the row and stops there; the projector catches up when
 * that day becomes current.
 */
async function maybeRefreshProjector(
  tx: Tx,
  userId: string,
  date: DateOnly,
  clock: Clock,
): Promise<void> {
  const projector = presenceProjector();
  if (projector === null) return;
  const now = clock.now();
  const currentDay = await currentDayFor(tx, userId, now);
  if (date !== currentDay) return;
  await projector.refresh(tx, userId, now);
}
