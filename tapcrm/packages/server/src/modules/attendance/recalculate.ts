import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import type { GenerationDecision } from '../../platform/jobs/generation.js';
import { addDays } from '../../platform/time.js';
import { calculate } from './calculate.js';
import * as calc from './calculation-repository.js';
import { isEmployedOn } from './employment.js';
import { applyCloseDecision, reattribute } from './ledger.js';
import { breakPolicyResolver } from './ports.js';
import { findAppUser, hasRetiredAutoOut, lockPerson } from './repository.js';

/**
 * Recalculation — design §8.5 (AT-2, AT-I3, AT-I4).
 *
 * Every change to a day's inputs bumps its input version in the transaction
 * that made it and writes `attendance.recalc-requested`; after commit the
 * handler queues one job per record and version. A shift or calendar change
 * arrives as an outbox event instead, and becomes one refresh request per
 * person. Nothing here opens a transaction except the functions that take a
 * context: they run one transaction per person and chunk, so a long range
 * never holds one person's lock for long.
 *
 * Nothing is lost on the way. A stale day and an open refresh request are
 * both durable rows, and the sweeper offers each again until it is done, or
 * flags it for a person after the third failed generation (§5.4).
 */

/** A range is refreshed this many days at a time, one transaction each. */
const CHUNK_DAYS = 31;
/** The sweeper leaves work alone for this long: the normal path is faster (§8.5). */
const STALE_AFTER_MS = 60_000;
const SWEEP_PAGE = 500;

export type RecalculationOutcome = 'calculated' | 'current' | 'missing';

/**
 * The job's work, in the caller's transaction: the person's lock, then the
 * day's row (D24); stop when the stored answer is already for the newest
 * inputs; otherwise load the inputs, calculate, store and rebuild the month.
 *
 * It calculates the inputs as they are now, and records that version. So an
 * older job that runs after newer inputs arrived does the newer job's work,
 * and the newer job then finds nothing to do.
 */
export async function recalculateRecord(
  tx: Tx,
  recordId: string,
): Promise<RecalculationOutcome> {
  const owner = await calc.recordOwner(tx, recordId);
  if (owner === null) return 'missing';
  await lockPerson(tx, owner.userId);
  const record = await calc.lockRecordForCalculation(tx, recordId);
  if (record.calculatedInputVersion >= record.inputVersion) return 'current';
  const person = await findAppUser(tx, owner.userId);

  const retiredAutoOut = await hasRetiredAutoOut(tx, recordId);
  const attributionFlags = retiredAutoOut
    ? [...new Set([...record.attributionFlags, 'reconciled-from-auto-close'])]
    : record.attributionFlags;

  // Resolve break policy from stored snapshots (D19: null = paid breaks, no limits).
  const resolver = breakPolicyResolver();
  const policySnapshot = resolver !== null
    ? await resolver.resolvePolicy(
        tx,
        record.organizationId,
        record.userId,
        record.workDate,
        record.placementSnapshot,
        record.shiftSnapshot,
      )
    : null;

  const result = calculate({
    workDate: record.workDate,
    shift: record.shiftSnapshot,
    closingCap: record.closeDueAt,
    closed: record.state === 'closed',
    dayType: record.dayType,
    // A day outside the employment window stays, marked not-employed (§8.6).
    employed: person !== null && isEmployedOn(person, record.workDate),
    events: await calc.effectiveEventsForRecord(tx, recordId),
    overlays: await calc.overlaysFor(tx, record.userId, record.workDate),
    breaksPaid: policySnapshot?.countsTowardWorkHours ?? true,  // D19
    nightWindow: await calc.nightWindowOn(tx, record.workDate),
    attributionFlags,
  });
  await calc.writeCalculation(tx, recordId, record.inputVersion, result, policySnapshot);
  await calc.refreshMonthSummary(tx, record.userId, record.workDate);
  return 'calculated';
}

/**
 * `AttendanceFacade.requestRecalculation` (§4) — for a past shift or calendar
 * change (SH-6, HO-3). Refreshes the facts of the days around `dates`, closed
 * ones included, and re-attributes them. Every day whose facts, events or
 * flags moved gets a new input version, and so a recalculation; a day that
 * nothing reached keeps its answer. Dates without a record are left to
 * day-open, which builds them from the shifts as they are then.
 */
export async function requestRecalculation(
  tx: Tx,
  userId: string,
  dates: readonly DateOnly[],
): Promise<void> {
  if (dates.length === 0) return;
  await lockPerson(tx, userId);
  const { touchedDates } = await reattribute(tx, userId, dates, { refreshClosed: true });
  // Re-derive closures for every date whose facts or closingCap changed.
  for (const date of [...touchedDates].sort()) {
    await applyCloseDecision(tx, userId, date);
  }
}

/** Sorted dates, cut into runs no longer than `days` calendar days. */
export function chunkDates(dates: readonly DateOnly[], days: number): DateOnly[][] {
  const chunks: DateOnly[][] = [];
  for (const date of [...dates].sort()) {
    const current = chunks[chunks.length - 1];
    if (current !== undefined && date <= addDays(current[0]!, days - 1))
      current.push(date);
    else chunks.push([date]);
  }
  return chunks;
}

/**
 * One person's days from `from` to `to` (inclusive; null for no end), 31
 * days per transaction. The day before `from` and the day after `to` are
 * included, because a day's closing edge depends on the next day's shift and
 * its opening edge on the previous one's (§5.2, §6.3). Returns how many days
 * it looked at.
 */
export async function refreshPersonDays(
  ctx: RequestContext,
  userId: string,
  from: DateOnly,
  to: DateOnly | null,
): Promise<number> {
  const dates = await db.transaction(ctx, (tx) =>
    calc.recordDates(tx, userId, addDays(from, -1), to === null ? null : addDays(to, 1)),
  );
  for (const chunk of chunkDates(dates, CHUNK_DAYS)) {
    await db.transaction(ctx, (tx) => requestRecalculation(tx, userId, chunk));
  }
  return dates.length;
}

export interface AffectedScope {
  readonly userIds?: readonly string[];
  readonly departmentIds?: readonly string[];
  readonly shiftIds?: readonly string[];
}

/** Whose days a shift or calendar change reaches: named people, or anyone with a day in reach. */
export async function affectedPeople(
  tx: Tx,
  scope: AffectedScope,
  from: DateOnly,
  to: DateOnly | null,
): Promise<string[]> {
  if (scope.userIds !== undefined) return [...new Set(scope.userIds)].sort();
  const filter = {
    ...(scope.departmentIds === undefined ? {} : { departmentIds: scope.departmentIds }),
    ...(scope.shiftIds === undefined ? {} : { shiftIds: scope.shiftIds }),
  };
  return calc.peopleWithDays(
    tx,
    filter,
    addDays(from, -1),
    to === null ? null : addDays(to, 1),
  );
}

/**
 * The outbox handler's half of a shift or calendar change, in the caller's
 * transaction: one refresh request per person with a day in reach. Once
 * these rows are written the change cannot be lost, because the sweeper
 * offers every open request again until it is done. Returns the change's
 * requests that are still open.
 */
export async function recordRefresh(
  tx: Tx,
  organizationId: string,
  eventId: string,
  scope: AffectedScope,
  from: DateOnly,
  to: DateOnly | null,
): Promise<calc.RefreshRequest[]> {
  const people = await affectedPeople(tx, scope, from, to);
  await calc.recordRefreshRequests(tx, organizationId, eventId, people, from, to);
  return calc.openRefreshRequestsFor(tx, eventId);
}

/** The refresh job's key: the request, and how many times a person has re-armed it. */
export const refreshKey = (request: { readonly id: string; readonly replays: number }) =>
  request.replays === 0 ? request.id : `${request.id}:r${request.replays}`;

/**
 * The `attendance.refresh-days` job: refreshes one request's days, then marks
 * it completed. Running it twice is harmless: the second pass finds nothing to
 * change. Returns how many days it looked at.
 */
export async function runRefreshRequest(
  ctx: RequestContext,
  requestId: string,
): Promise<number> {
  const request = await db.transaction(ctx, (tx) => calc.refreshRequest(tx, requestId));
  if (request === null || request.completedAt !== null || request.failedAt !== null)
    return 0;
  const days = await refreshPersonDays(
    ctx,
    request.userId,
    request.fromDate,
    request.toDate,
  );
  await db.transaction(ctx, (tx) => calc.completeRefreshRequest(tx, requestId));
  return days;
}

/** What a sweep needs from a job (§5.4). */
export interface SweptQueue<P> {
  enqueue(input: { organizationId: string; key: string; payload: P }): Promise<void>;
  nextGeneration(tx: Tx, baseKey: string, now: Date): Promise<GenerationDecision>;
}

interface Offer<P> {
  readonly key: string;
  readonly payload: P;
}

interface SweepPage<P> {
  readonly size: number;
  readonly lastId: string | null;
  readonly offers: readonly Offer<P>[];
  readonly flagged: number;
}

/**
 * Walks a sweep one page at a time, one transaction per page, and queues each
 * page's offers only after that page commits (TX-2).
 */
async function sweepInPages<P>(
  ctx: RequestContext,
  queue: SweptQueue<P>,
  page: (tx: Tx, after: string | null) => Promise<SweepPage<P>>,
): Promise<{ offered: number; flagged: number }> {
  let after: string | null = null;
  let offered = 0;
  let flagged = 0;
  for (;;) {
    const cursor: string | null = after;
    const result: SweepPage<P> = await db.transaction(ctx, (tx) => page(tx, cursor));
    for (const offer of result.offers) {
      await queue.enqueue({ organizationId: ctx.organizationId, ...offer });
    }
    offered += result.offers.length;
    flagged += result.flagged;
    if (result.size < SWEEP_PAGE || result.lastId === null) return { offered, flagged };
    after = result.lastId;
  }
}

/** The recalculation job's key: the record and the input version it was asked for. */
export const recalculationKey = (recordId: string, inputVersion: number) =>
  `${recordId}:${inputVersion}`;

/**
 * The stale sweeper, for days (§8.5): every day stale for more than a minute
 * is offered to the queue again under its next generation, so a lost message
 * cannot leave a day wrong. After the third generation dead-letters, the day
 * is flagged `recalculation-failed` for a person, and stays stale — which
 * keeps it out of a payroll snapshot (§14).
 */
export async function sweepStale(
  ctx: RequestContext,
  queue: SweptQueue<{ recordId: string }>,
  now: Date,
): Promise<{ offered: number; flagged: number }> {
  const changedBefore = new Date(now.getTime() - STALE_AFTER_MS);
  return sweepInPages(ctx, queue, async (tx, after) => {
    const rows = await calc.staleRecords(tx, changedBefore, after, SWEEP_PAGE);
    const offers: Offer<{ recordId: string }>[] = [];
    let flagged = 0;
    for (const row of rows) {
      const decision = await queue.nextGeneration(
        tx,
        recalculationKey(row.id, row.inputVersion),
        now,
      );
      if (decision.kind === 'run')
        offers.push({ key: decision.key, payload: { recordId: row.id } });
      if (decision.kind === 'exhausted') {
        await calc.flagRecalculationFailed(tx, row.id);
        flagged += 1;
      }
    }
    return {
      size: rows.length,
      lastId: rows[rows.length - 1]?.id ?? null,
      offers,
      flagged,
    };
  });
}

/**
 * The stale sweeper, for refresh requests: every request still open a minute
 * after it was written is offered again under its next generation. A key
 * that already finished completes the request. After the third generation
 * dead-letters, the request is marked failed and waits for a person, who can
 * run it again by raising its `replays` (a new key, so generations restart).
 */
export async function sweepRefreshRequests(
  ctx: RequestContext,
  queue: SweptQueue<{ requestId: string }>,
  now: Date,
): Promise<{ offered: number; flagged: number }> {
  const requestedBefore = new Date(now.getTime() - STALE_AFTER_MS);
  return sweepInPages(ctx, queue, async (tx, after) => {
    const rows = await calc.staleRefreshRequests(tx, requestedBefore, after, SWEEP_PAGE);
    const offers: Offer<{ requestId: string }>[] = [];
    let flagged = 0;
    for (const row of rows) {
      const decision = await queue.nextGeneration(tx, refreshKey(row), now);
      if (decision.kind === 'run')
        offers.push({ key: decision.key, payload: { requestId: row.id } });
      if (decision.kind === 'done') await calc.completeRefreshRequest(tx, row.id);
      if (decision.kind === 'exhausted') {
        await calc.failRefreshRequest(tx, row.id);
        flagged += 1;
      }
    }
    return {
      size: rows.length,
      lastId: rows[rows.length - 1]?.id ?? null,
      offers,
      flagged,
    };
  });
}
