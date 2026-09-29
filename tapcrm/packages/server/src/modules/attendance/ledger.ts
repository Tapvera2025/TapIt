import type {
  AssignmentReason,
  AttendanceEventInput,
  DateOnly,
  EligibilityWindow,
  EventKind,
  EventSource,
  Evidence,
} from '@tapcrm/contracts';
import { PINNED_REASONS, readDay } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import {
  addDays,
  localDateOf,
  systemClock,
  wholeSeconds,
  type Clock,
} from '../../platform/time.js';
import { closeDecision } from './close.js';
import * as CalendarFacade from '../holidays/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import {
  attributeAll,
  currentDay,
  dayOfWindow,
  type LedgerEvent,
  type Placement,
} from './attribute.js';
import { factsFor, type DayFacts } from './day-facts.js';
import { isEmployedOn } from './employment.js';
import {
  ATTENDANCE_ERROR_CODES,
  AttendanceConflictError,
  AttendanceNotFoundError,
} from './errors.js';
import { presenceProjector } from './ports.js';
import * as repo from './repository.js';

/**
 * The ledger — design §8.4. Every writer follows one lock order: the person's
 * advisory lock first, then record rows (D24). Nothing here opens a
 * transaction; each function runs inside the caller's (MB-2, TX-5).
 */

/** How far a neighbourhood pass may widen before it stops (§8.4 step 9). */
const MAX_PASSES = 6;
/** Recorded placements are read this far either side: every neighbour a window looks at. */
const PLACEMENT_MARGIN_DAYS = 7;

async function organizationIdOf(tx: Tx): Promise<string> {
  return (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;
}

/**
 * Facts for every date `first..last`, from shifts (§5.2, §8.5). A day already
 * built is resolved with the department it recorded, not today's (§8.1).
 */
async function loadFacts(
  tx: Tx,
  userId: string,
  first: DateOnly,
  last: DateOnly,
): Promise<Map<DateOnly, DayFacts>> {
  const recorded = await repo.placementsBetween(
    tx,
    userId,
    addDays(first, -PLACEMENT_MARGIN_DAYS),
    addDays(last, PLACEMENT_MARGIN_DAYS),
  );
  return factsFor(
    await ShiftsFacade.shiftDays(tx, userId, addDays(first, -1), addDays(last, 1), {
      placements: recorded,
    }),
  );
}

/** The stored facts of one day: its shift facts and its calendar answer (§8.5). */
function toFactsRow(
  date: DateOnly,
  fact: DayFacts,
  dayType: repo.DayFactsRow['dayType'] | undefined,
): repo.DayFactsRow {
  return {
    workDate: date,
    windowStart: fact.windowStart,
    windowEnd: fact.windowEnd,
    closeDueAt: fact.closingCap,
    shift: fact.shift,
    dayType: dayType ?? 'working',
  };
}

/**
 * The facts of a single day, for a day that is being built (§8.6 day-open):
 * the same shift facts, recorded departments and calendar answer the
 * neighbourhood pass uses, so a day has one definition, not two that drift
 * (§8.5 `refreshDayFacts`).
 */
export async function factsForDay(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<repo.DayFactsRow> {
  const facts = await loadFacts(tx, userId, date, date);
  const recorded = await repo.placementsBetween(tx, userId, date, date);
  const types = await dayTypes(tx, userId, date, date, recorded);
  return toFactsRow(date, facts.get(date)!, types.get(date));
}

/**
 * Each date's day type: the calendar's answer, except that a date outside the
 * person's employment window is `not-employed` (§8.6) — the day stays, marked,
 * with whatever events it holds.
 */
async function dayTypes(
  tx: Tx,
  userId: string,
  first: DateOnly,
  last: DateOnly,
  recorded: ReadonlyMap<DateOnly, repo.Placement>,
): Promise<Map<DateOnly, repo.DayFactsRow['dayType']>> {
  const person = await repo.findAppUser(tx, userId);
  const calendar = await CalendarFacade.dayTypeRange(tx, userId, first, last, {
    placements: recorded,
  });
  return new Map(
    calendar.map((day) => [
      day.date,
      person !== null && isEmployedOn(person, day.date) ? day.type : 'not-employed',
    ]),
  );
}

function toInput(row: repo.NeighbourhoodEvent): AttendanceEventInput {
  return {
    id: row.id,
    kind: row.kind,
    at: row.occurredAt.toISOString(),
    source: row.source,
    evidence: row.evidence,
    assignmentReason: row.reason ?? 'midpoint',
  };
}

const isPinned = (reason: AssignmentReason) => PINNED_REASONS.includes(reason);

interface PassResult {
  readonly placements: ReadonlyMap<string, Placement>;
  readonly touchedDates: ReadonlySet<DateOnly>;
}

export interface ReattributeOptions {
  /** Refresh the facts of closed days as well: a past shift or calendar change (SH-6, HO-3). */
  readonly refreshClosed?: boolean;
  /** Seed the internal touched set with these record IDs (for correction approvals). */
  readonly additionalTouchedRecordIds?: ReadonlySet<string>;
}

/**
 * §8.4 step 9 — re-attribute the neighbourhood: the day before, the days
 * given, the day after. Only assignments whose day or reason changes are
 * written; pinned ones stay. Every record that gained, lost or re-explained an
 * event, or whose facts or flags changed, gets a new input version and a
 * recalculation request. If an event moves onto or off an outer day, the pass
 * widens by a day on that side.
 */
export async function reattribute(
  tx: Tx,
  userId: string,
  around: readonly DateOnly[],
  options: ReattributeOptions = {},
): Promise<PassResult> {
  const organizationId = await organizationIdOf(tx);
  const sorted = [...around].sort();
  let lo = addDays(sorted[0]!, -1);
  let hi = addDays(sorted[sorted.length - 1]!, 1);

  let facts = new Map<DateOnly, DayFacts>();
  let events: repo.NeighbourhoodEvent[] = [];
  let recomputed = new Set<string>();
  let placements: ReadonlyMap<string, Placement> = new Map();
  let flags: ReadonlyMap<DateOnly, ReadonlySet<string>> = new Map();

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    facts = await loadFacts(tx, userId, addDays(lo, -2), addDays(hi, 2));
    events = await repo.effectiveEventsOf(
      tx,
      userId,
      {
        from: facts.get(addDays(lo, -1))!.windowStart,
        to: facts.get(addDays(hi, 1))!.windowEnd,
      },
      { first: addDays(lo, -2), last: addDays(hi, 2) },
    );
    recomputed = new Set();
    const ledger: LedgerEvent[] = [];
    for (const row of events) {
      const event = toInput(row);
      const fixed =
        row.assignedDate !== null && row.reason !== null
          ? { date: row.assignedDate, reason: row.reason }
          : undefined;
      const windowDay = dayOfWindow(facts, row.occurredAt)?.date;
      const inside = windowDay !== undefined && windowDay >= lo && windowDay <= hi;
      if (fixed !== undefined && (isPinned(fixed.reason) || !inside))
        ledger.push({ event, fixed });
      else if (inside) {
        ledger.push({ event });
        recomputed.add(row.id);
      }
    }
    ({ placements, flags } = attributeAll(ledger, facts));

    let widenLow = false;
    let widenHigh = false;
    for (const row of events) {
      if (!recomputed.has(row.id)) continue;
      const next = placements.get(row.id);
      if (
        next === undefined ||
        (next.date === row.assignedDate && next.reason === row.reason)
      )
        continue;
      if (next.date === lo || row.assignedDate === lo) widenLow = true;
      if (next.date === hi || row.assignedDate === hi) widenHigh = true;
    }
    if ((!widenLow && !widenHigh) || pass === MAX_PASSES - 1) break;
    if (widenLow) lo = addDays(lo, -1);
    if (widenHigh) hi = addDays(hi, 1);
  }

  // Materialise every day that owns an event, then lock the days in range.
  const first = addDays(lo, -1);
  const last = addDays(hi, 1);
  const recorded = await repo.placementsBetween(tx, userId, first, last);
  const calendar = await dayTypes(tx, userId, first, last, recorded);
  const factsRow = (date: DateOnly) =>
    toFactsRow(date, facts.get(date)!, calendar.get(date));
  const owning = new Set<DateOnly>();
  for (const id of recomputed) {
    const placement = placements.get(id);
    if (placement !== undefined) owning.add(placement.date);
  }
  const placement = await repo.currentPlacement(tx, userId);
  await repo.materialise(
    tx,
    organizationId,
    userId,
    [...owning].sort().map(factsRow),
    placement,
  );
  const range: DateOnly[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) range.push(date);
  const records = await repo.lockRecords(tx, userId, range);

  // Seed from any caller-supplied records (correction approval may touch records outside the range).
  const touched = new Set<string>(options.additionalTouchedRecordIds ?? []);
  // refreshDayFacts (§8.5): open days follow the shifts; closed days only
  // when a shift or calendar change says so (SH-6, HO-3).
  for (const record of records.values()) {
    if (
      await repo.refreshFacts(
        tx,
        record.id,
        factsRow(record.workDate),
        options.refreshClosed === true,
      )
    )
      touched.add(record.id);
  }
  for (const row of events) {
    if (!recomputed.has(row.id)) continue;
    const next = placements.get(row.id);
    const record = next === undefined ? undefined : records.get(next.date);
    if (next === undefined || record === undefined) continue;
    const { changed, previousRecordId } = await repo.assign(tx, {
      organizationId,
      userId,
      eventId: row.id,
      recordId: record.id,
      reason: next.reason,
      pinned: isPinned(next.reason),
    });
    if (!changed) continue;
    touched.add(record.id);
    if (previousRecordId !== null) touched.add(previousRecordId);
  }
  // Attribution flags: rewritten inside the range, added to the days either side.
  // A day whose shift overlaps a neighbour's is flagged too, and the
  // calculator leaves it unevaluated (§5.2).
  for (const record of records.values()) {
    const raised = [...(flags.get(record.workDate) ?? [])];
    if (facts.get(record.workDate)?.overlap === true) raised.push('shift-window-overlap');
    const inside = record.workDate >= lo && record.workDate <= hi;
    const next = inside ? raised : [...new Set([...record.attributionFlags, ...raised])];
    if (await repo.setAttributionFlags(tx, record.id, next)) touched.add(record.id);
  }
  await repo.bumpInputVersions(tx, organizationId, userId, touched);

  // Build a reverse lookup from record ID to workDate for the locked range.
  const recordById = new Map<string, DateOnly>();
  for (const rec of records.values()) recordById.set(rec.id, rec.workDate);

  // Convert touched record IDs to work dates.
  const touchedDates = new Set<DateOnly>();
  for (const recordId of touched) {
    const workDate = recordById.get(recordId);
    if (workDate !== undefined) touchedDates.add(workDate);
  }
  return { placements, touchedDates };
}

/* ------------------------------------------------------------------ *
 * appendEvent — §8.4
 * ------------------------------------------------------------------ */

export interface PunchLocation {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM?: number | undefined;
}

export interface AppendEventInput {
  readonly userId: string;
  readonly kind: EventKind;
  readonly at: Date;
  readonly source: EventSource;
  readonly evidence: Evidence;
  /** The raw punch a device event came from: required for `source: 'device'`, and only for it. */
  readonly biometricPunchId?: string | null;
  readonly remote?: boolean;
  readonly clientEventId?: string | null;
  readonly clientRequestHash?: string | null;
  readonly clientTime?: Date | null;
  readonly recordedBy?: string | null;
  /**
   * Browser geolocation for the punch (WFH-6 / ID-16). Currently unused by
   * the ledger — the arrival-policy branch (§8.4 step 7) lands with step 4's
   * punch route and will pass this to `GeofenceFacade.evaluatePunch`.
   */
  readonly location?: PunchLocation | null;
}

export interface AppendEventResult {
  readonly eventId: string;
  readonly workDate: DateOnly | null;
  readonly reason: AssignmentReason | null;
  /** True when a retried client event, or a device punch delivered again, returned its first result. */
  readonly replayed: boolean;
}

async function replayed(
  tx: Tx,
  input: AppendEventInput,
): Promise<AppendEventResult | null> {
  // A device punch is known by its raw punch. Delivered again, it returns the
  // event its first delivery made, even if that event has since been retired:
  // the punch has had its effect, and one raw punch makes one event (AT-I4).
  if (input.biometricPunchId != null) {
    const first = await repo.findEventByBiometricPunchId(
      tx,
      input.userId,
      input.biometricPunchId,
    );
    if (first === null) return null;
    return {
      eventId: first.eventId,
      workDate: first.workDate,
      reason: first.reason,
      replayed: true,
    };
  }
  if (input.clientEventId == null) return null;
  const first = await repo.findClientEvent(tx, input.userId, input.clientEventId);
  if (first === null) return null;
  if ((first.clientRequestHash ?? null) !== (input.clientRequestHash ?? null)) {
    throw new AttendanceConflictError(
      ATTENDANCE_ERROR_CODES.CLIENT_EVENT_REUSED,
      'This client event id was already used for a different punch.',
    );
  }
  return {
    eventId: first.eventId,
    workDate: first.workDate,
    reason: first.reason,
    replayed: true,
  };
}

/**
 * Steps 1–4, 8, 9 and 12 of §8.4. The interactive checks of step 7 arrive
 * with the punch route (step 4), closure re-derivation (step 10) with
 * auto-close (step 7), and the board (step 11) through the projector port.
 */
export async function appendEvent(
  tx: Tx,
  input: AppendEventInput,
  clock: Clock = systemClock,
): Promise<AppendEventResult> {
  // 1. The cheap check: a retry of a punch already recorded.
  const fast = await replayed(tx, input);
  if (fast !== null) return fast;
  // 2. One punch at a time per person.
  await repo.lockPerson(tx, input.userId);
  // 3. Again under the lock, so two identical retries get one answer, not a unique violation.
  const locked = await replayed(tx, input);
  if (locked !== null) return locked;

  const result = await insertLocked(tx, input, [], clock);
  await refreshBoard(tx, input.userId, clock);
  return result;
}

/** Why `replaceDeviceEvent` appended nothing; the caller records it for review. */
export type ReplacementRefusal =
  /** A correction already superseded the displaced event: a human decision is changed only by a human. */
  | 'already-superseded'
  /** The displaced event is someone else's: a burst never joins two people (D34). */
  | 'other-person'
  /** The displaced event was not recorded by a device: a device punch never retires a manual one. */
  | 'not-a-device-event';

export type ReplaceDeviceEventResult =
  | (AppendEventResult & { readonly outcome: 'appended' })
  | { readonly outcome: 'refused'; readonly reason: ReplacementRefusal };

/**
 * §10.3 step 7: a punch that turns out to be the earliest of its duplicate
 * burst takes the place of the burst's applied head. Under the person's lock
 * it retires the displaced device event with a system void, appends the new
 * device event, re-attributes once and refreshes the board once — one unit in
 * the caller's transaction, so a failure leaves neither half.
 *
 * Refuses, appending nothing, when the displaced event is another person's,
 * was not recorded by a device, or was already superseded (a correction). A
 * device event never supersedes anything itself; the void does (migration 0050).
 */
export async function replaceDeviceEvent(
  tx: Tx,
  displacedEventId: string,
  input: AppendEventInput,
  clock: Clock = systemClock,
): Promise<ReplaceDeviceEventResult> {
  if (input.source !== 'device' || input.biometricPunchId == null) {
    throw new TypeError('replaceDeviceEvent appends a device event with its raw punch.');
  }
  const fast = await replayed(tx, input);
  if (fast !== null) return { outcome: 'appended', ...fast };
  await repo.lockPerson(tx, input.userId);
  const locked = await replayed(tx, input);
  if (locked !== null) return { outcome: 'appended', ...locked };

  const displaced = await repo.findEvent(tx, displacedEventId);
  if (displaced === null)
    throw new AttendanceNotFoundError(
      ATTENDANCE_ERROR_CODES.EVENT_NOT_FOUND,
      'No such attendance event.',
    );
  if (displaced.userId !== input.userId)
    return { outcome: 'refused', reason: 'other-person' };
  if (displaced.source !== 'device')
    return { outcome: 'refused', reason: 'not-a-device-event' };
  if (displaced.superseded) return { outcome: 'refused', reason: 'already-superseded' };

  const retired = await voidLocked(tx, displaced);
  const result = await insertLocked(tx, input, [retired.date], clock);
  await refreshBoard(tx, input.userId, clock);
  return { outcome: 'appended', ...result };
}

/**
 * Records one event and re-attributes its neighbourhood, widened to `alsoAround`
 * (the day of an event retired in the same unit). The person's lock is held.
 */
async function insertLocked(
  tx: Tx,
  input: AppendEventInput,
  alsoAround: readonly DateOnly[],
  clock: Clock = systemClock,
): Promise<AppendEventResult> {
  const at = wholeSeconds(input.at); // T-6
  const organizationId = await organizationIdOf(tx);
  const eventId = await repo.insertEvent(tx, {
    organizationId,
    userId: input.userId,
    kind: input.kind,
    occurredAt: at,
    source: input.source,
    evidence: input.evidence,
    biometricPunchId: input.biometricPunchId ?? null,
    remote: input.remote ?? false,
    clientEventId: input.clientEventId ?? null,
    clientRequestHash: input.clientRequestHash ?? null,
    clientTime: input.clientTime ?? null,
    recordedBy: input.recordedBy ?? null,
  });
  const local = localDateOf(at, await organizationTimezone(tx));
  const { placements, touchedDates } = await reattribute(tx, input.userId, [local, ...alsoAround]);
  const placement = placements.get(eventId) ?? null;
  const assignedDate = placement?.date ?? null;
  // Re-derive closure for every touched date and the new event's date.
  const closureDates = new Set<DateOnly>([...touchedDates, ...alsoAround]);
  if (assignedDate !== null) closureDates.add(assignedDate);
  for (const date of [...closureDates].sort()) {
    await applyCloseDecision(tx, input.userId, date, clock);
  }
  return {
    eventId,
    workDate: assignedDate,
    reason: placement?.reason ?? null,
    replayed: false,
  };
}

/* ------------------------------------------------------------------ *
 * retireEvent — §8.4, §10.3 step 7
 * ------------------------------------------------------------------ */

export type RetireResult =
  | { readonly retired: true; readonly voidEventId: string }
  /** A correction already superseded it: a human decision is changed only by a human. */
  | { readonly retired: false; readonly reason: 'already-superseded' };

/**
 * Retires one effective event with a system void row, pinned to the day it was
 * on, then re-attributes the neighbourhood and refreshes the board — the same
 * steps as an append, without one. Used when a duplicate punch bridges two
 * bursts (step 5) and when a re-derived closure retires an auto-out (step 7).
 */
export async function retireEvent(
  tx: Tx,
  eventId: string,
  clock: Clock = systemClock,
): Promise<RetireResult> {
  const found = await repo.findEvent(tx, eventId);
  if (found === null)
    throw new AttendanceNotFoundError(
      ATTENDANCE_ERROR_CODES.EVENT_NOT_FOUND,
      'No such attendance event.',
    );
  await repo.lockPerson(tx, found.userId);
  const target = (await repo.findEvent(tx, eventId))!;
  if (target.isVoid || target.superseded)
    return { retired: false, reason: 'already-superseded' };

  const retired = await voidLocked(tx, target);
  const { touchedDates } = await reattribute(tx, target.userId, [retired.date]);
  const closureDates = new Set<DateOnly>([...touchedDates, retired.date]);
  for (const date of [...closureDates].sort()) {
    await applyCloseDecision(tx, target.userId, date, clock);
  }
  await refreshBoard(tx, target.userId, clock);
  return { retired: true, voidEventId: retired.voidEventId };
}

/**
 * Appends the system void that retires `target`, pinned to the day the event
 * was on, and marks that day out of date. Returns the day to re-attribute
 * around. The person's lock is held; nothing is re-attributed here, so a
 * combined operation passes over the neighbourhood once.
 */
async function voidLocked(
  tx: Tx,
  target: repo.StoredEvent,
): Promise<{ voidEventId: string; date: DateOnly }> {
  const organizationId = await organizationIdOf(tx);
  const voidEventId = await repo.insertEvent(tx, {
    organizationId,
    userId: target.userId,
    kind: target.kind,
    occurredAt: target.occurredAt,
    source: 'system',
    evidence: target.evidence,
    supersedesEventId: target.id,
    isVoid: true,
  });
  if (target.recordId !== null) {
    await repo.assign(tx, {
      organizationId,
      userId: target.userId,
      eventId: voidEventId,
      recordId: target.recordId,
      reason: 'reconciliation',
      pinned: true,
    });
    // The day lost an effective event: its answer is out of date even when
    // no other event moves (the pass bumps only days whose assignments
    // changed).
    await repo.bumpInputVersions(
      tx,
      organizationId,
      target.userId,
      new Set([target.recordId]),
    );
  }
  const date =
    target.workDate ?? localDateOf(target.occurredAt, await organizationTimezone(tx));
  return { voidEventId, date };
}

/**
 * Appends a system void for an auto-out and pins it to the record.
 * Does NOT bump the input version; the caller does that once for the whole decision.
 */
async function voidAutoOut(
  tx: Tx,
  organizationId: string,
  userId: string,
  autoOutId: string,
  recordId: string,
): Promise<void> {
  const target = await repo.findEvent(tx, autoOutId);
  if (target === null) return;
  const voidId = await repo.insertEvent(tx, {
    organizationId,
    userId,
    kind: 'auto-out',
    occurredAt: target.occurredAt,
    source: 'system',
    evidence: 'assumed',
    supersedesEventId: autoOutId,
    isVoid: true,
  });
  await repo.assign(tx, {
    organizationId,
    userId,
    eventId: voidId,
    recordId,
    reason: 'reconciliation',
    pinned: true,
  });
}

/**
 * Re-derives the closure answer for one day — §12.3. Caller holds the person's
 * advisory lock. Applies to open AND closed records (§12.4): a later real
 * departure overrides a prior auto-out.
 */
export async function applyCloseDecision(
  tx: Tx,
  userId: string,
  workDate: DateOnly,
  clock: Clock = systemClock,
): Promise<void> {
  const organizationId = await organizationIdOf(tx);
  const record = await repo.findRecordForClosure(tx, userId, workDate);
  if (record === null || record.dayType === 'not-employed') return;
  const facts = (await loadFacts(tx, userId, workDate, workDate)).get(workDate);
  if (facts === undefined || facts.overlap) return;

  const raw = await repo.effectiveEventsOfRecord(tx, record.id, { excludeAutoOut: true });
  const events = raw.map(toInput);
  const decision = closeDecision(
    events, facts.eligibility, facts.shiftEnd, record.closeDueAt, clock.now(),
  );
  const old = await repo.findAutoOutForRecord(tx, record.id);
  let ledgerChanged = false;

  const retireOld = async (note: string): Promise<void> => {
    if (old === null) return;
    await voidAutoOut(tx, organizationId, userId, old.id, record.id);
    ledgerChanged = true;
    await repo.resolveReviewItem(tx, organizationId, {
      userId, workDate, kind: 'assumed-departure', eventId: old.id, note,
    });
  };

  let answer:
    | { state: 'open'; closedBy: null }
    | { state: 'closed'; closedBy: 'punch-out' | 'auto-close' | 'no-show' | 'correction' };

  if (decision.kind === 'still-open') {
    await retireOld('Re-derived as still open.');
    answer = { state: 'open', closedBy: null };
  } else if (decision.kind === 'real-departure') {
    await retireOld('Replaced by a real departure.');
    const departure = readDay(events, facts.eligibility).departure;
    const corrected = raw.some((e) =>
      e.source === 'correction' && departure?.eventIds.includes(e.id));
    answer = { state: 'closed', closedBy: corrected ? 'correction' : 'punch-out' };
  } else if (decision.kind === 'no-show') {
    await retireOld('Re-derived as no-show.');
    answer = { state: 'closed', closedBy: 'no-show' };
  } else {
    if (old === null || old.occurredAt.getTime() !== decision.at.getTime()) {
      await retireOld(`Re-derived auto-out at ${decision.at.toISOString()}.`);
      const autoOutId = await repo.insertEvent(tx, {
        organizationId, userId, kind: 'auto-out', occurredAt: decision.at,
        source: 'system', evidence: 'assumed',
      });
      await repo.assign(tx, {
        organizationId, userId, eventId: autoOutId, recordId: record.id,
        reason: 'system-close', pinned: true,
      });
      ledgerChanged = true;
      if (decision.basis !== 'last-scan') {
        await repo.upsertReviewItem(tx, organizationId, {
          userId, workDate, kind: 'assumed-departure', eventId: autoOutId,
          detail: { basis: decision.basis, autoOutAt: decision.at.toISOString() },
        });
      }
    }
    answer = { state: 'closed', closedBy: 'auto-close' };
  }

  const closureChanged = await repo.setRecordClosure(tx, record.id, answer, clock.now());
  // Any successful derivation supersedes a prior evaluation failure.
  await repo.resolveReviewItem(tx, organizationId, {
    userId, workDate, kind: 'auto-close-failed',
    note: 'Closure was successfully re-derived.',
  });
  if (ledgerChanged || closureChanged)
    await repo.bumpInputVersions(tx, organizationId, userId, new Set([record.id]));
}

/**
 * The eligibility window for one day — used by the correction service to read
 * whether a proposed event would be applied.
 */
export async function eligibilityForDay(
  tx: Tx,
  userId: string,
  workDate: DateOnly,
): Promise<EligibilityWindow> {
  const facts = (await loadFacts(tx, userId, workDate, workDate)).get(workDate);
  return facts?.eligibility ?? null;
}

/**
 * The board follows every change to a person's events (LS-8): refreshed once,
 * at the present moment, after the ledger has settled — so a retirement or a
 * replay on an old day leaves the board on the person's current day.
 */
async function refreshBoard(tx: Tx, userId: string, clock: Clock): Promise<void> {
  const projector = presenceProjector();
  if (projector !== null) await projector.refresh(tx, userId, clock.now());
}

/* ------------------------------------------------------------------ *
 * Read-only questions
 * ------------------------------------------------------------------ */

async function placedAround(tx: Tx, userId: string, at: Date) {
  const local = localDateOf(at, await organizationTimezone(tx));
  const facts = await loadFacts(tx, userId, addDays(local, -3), addDays(local, 3));
  const events = await repo.effectiveEventsOf(
    tx,
    userId,
    {
      from: facts.get(addDays(local, -2))!.windowStart,
      to: facts.get(addDays(local, 2))!.windowEnd,
    },
    { first: addDays(local, -3), last: addDays(local, 3) },
  );
  return { facts, events };
}

/** §5.2 — which day would own this event, and why, given everything recorded so far. */
export async function attributeEvent(
  tx: Tx,
  input: { readonly userId: string; readonly kind: EventKind; readonly occurredAt: Date },
): Promise<{
  readonly placement: Placement | null;
  readonly flags: ReadonlyMap<DateOnly, ReadonlySet<string>>;
}> {
  const at = wholeSeconds(input.occurredAt);
  const { facts, events } = await placedAround(tx, input.userId, at);
  const probe: AttendanceEventInput = {
    id: 'proposed',
    kind: input.kind,
    at: at.toISOString(),
    source: 'web',
    evidence: 'confirmed',
    assignmentReason: 'midpoint',
  };
  const ledger: LedgerEvent[] = events
    .filter((row) => row.assignedDate !== null && row.reason !== null)
    .map((row) => ({
      event: toInput(row),
      fixed: { date: row.assignedDate!, reason: row.reason! },
    }));
  const { placements, flags } = attributeAll([...ledger, { event: probe }], facts);
  return { placement: placements.get(probe.id) ?? null, flags };
}

/** §5.2 — the day the person is IN at `at`. */
export async function currentDayFor(
  tx: Tx,
  userId: string,
  at: Date,
): Promise<DateOnly | null> {
  const { facts, events } = await placedAround(tx, userId, at);
  const placed = events
    .filter((row) => row.assignedDate !== null)
    .map((row) => ({ event: toInput(row), date: row.assignedDate! }));
  return currentDay(facts, placed, at);
}
