import { randomUUID } from 'node:crypto';
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { addDays, systemClock, type Clock } from '../../platform/time.js';
import { opensDaysOn } from './employment.js';
import { currentDayFor, factsForDay } from './ledger.js';
import { presenceProjector } from './ports.js';
import * as repo from './repository.js';

/**
 * Day-open (§8.6). Materialises `attendance_record` rows forward from the
 * organization's watermark, and offers the same single-record path to any
 * caller that wants a row to exist for a specific date (`applyOverlay`).
 *
 * Two entry points, one shared body:
 *
 *   openDay(tx, userId, date)
 *       Strictly idempotent. Emits `attendance.recalc-requested` on create.
 *       No-op when the record already exists.
 *
 *   ensureDayRecord(tx, userId, date, { emitRecalc: false })
 *       Used by the overlay path. The overlay itself is the input change,
 *       and it emits the one recalc event for the combined write. Emitting
 *       here would double-count.
 *
 * Both take the per-person advisory lock (same key as 3a's `appendEvent`,
 * §8.4 D24), so no concurrent punch can race the check-then-insert. A new
 * day's facts come from the ledger's own definition (`factsForDay`), the
 * one the neighbourhood pass uses, so a day has one definition (§8.5).
 */

export async function openDay(
  tx: Tx,
  userId: string,
  date: DateOnly,
  clock: Clock = systemClock,
): Promise<{ created: boolean }> {
  const { created } = await ensureDayRecord(tx, userId, date, { emitRecalc: true });
  if (created) {
    await maybeRefreshProjector(tx, userId, date, clock);
  }
  return { created };
}

/**
 * LS-4: give the board its NOT_IN row for TODAY now, not on the next
 * 5-minute sweep. Guarded so historical catch-up (e.g. materialising
 * 2026-09-22 while today is 2026-09-25) does not rebuild today's row
 * from an old date. A missing projector (before step 4 is deployed)
 * is a no-op.
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
  if (date !== currentDay) return; // historical materialisation — not our concern
  await projector.refresh(tx, userId, now);
}

export async function ensureDayRecord(
  tx: Tx,
  userId: string,
  date: DateOnly,
  options: { emitRecalc: boolean },
): Promise<{ created: boolean; recordId: string | null }> {
  const person = await repo.findAppUser(tx, userId);
  if (person === null || !opensDaysOn(person, date)) {
    return { created: false, recordId: null };
  }

  await repo.lockPerson(tx, userId);

  const existing = await repo.findRecordByDate(tx, userId, date);
  if (existing !== null) return { created: false, recordId: existing.id };

  const facts = await factsForDay(tx, userId, date);
  const recordId = await repo.insertNewRecord(tx, {
    organizationId: person.organizationId,
    userId,
    workDate: date,
    windowStart: facts.windowStart,
    windowEnd: facts.windowEnd,
    closeDueAt: facts.closeDueAt,
    shift: facts.shift,
    dayType: facts.dayType,
    placement: {
      departmentId: person.departmentId,
      teamId: person.teamId,
      positionId: person.positionId,
    },
  });

  if (options.emitRecalc) {
    await repo.writeRecalcRequested(tx, person.organizationId, {
      recordId,
      userId,
      workDate: date,
      inputVersion: 1,
    });
  }
  return { created: true, recordId };
}

export interface DayOpenOptions {
  /** Tests only: replaces the per-person opener, so one person can be made to fail. */
  readonly openOne?: (tx: Tx, userId: string, date: DateOnly) => Promise<unknown>;
}

/**
 * Ensures a row for every employed person across `from..to`. Whole-run
 * per-organization lease serialises against concurrent runs; per-person,
 * per-date small transactions keep earlier commits when a later date fails.
 *
 * Guard A: the watermark advances one date at a time, and only past a date
 * every person was opened on. The first date with a failure stops the run
 * and is recorded in `last_failed_date`; the next run starts there again.
 */
export async function openDaysForOrganization(
  ctx: RequestContext,
  from: DateOnly,
  to: DateOnly,
  options: DayOpenOptions = {},
): Promise<
  | { skipped: 'lease-held' }
  | { materialisedThrough: DateOnly; firstFailedDate: DateOnly | null }
> {
  const openOne = options.openOne ?? openDay;
  return withOrganizationDayOpenLease(ctx, async (holder) => {
    let firstFailed: DateOnly | null = null;

    for (let d = from; d <= to; d = addDays(d, 1)) {
      const ok = await tryOpenDate(ctx, d, openOne);
      if (!ok) {
        firstFailed = d;
        break;
      }
      // Each completed date also renews the lease, so a long catch-up is
      // never mistaken for an abandoned one.
      await db.transaction(ctx, async (tx) => {
        await repo.advanceWatermarkTo(tx, ctx.organizationId, d);
        await repo.renewDayOpenLease(tx, ctx.organizationId, holder);
      });
    }

    const failed = firstFailed;
    await db.transaction(ctx, (tx) =>
      failed === null
        ? repo.clearDayOpenFailure(tx, ctx.organizationId)
        : repo.recordDayOpenFailure(tx, ctx.organizationId, failed),
    );

    const state = await db.transaction(ctx, (tx) =>
      repo.readDayOpenState(tx, ctx.organizationId),
    );
    return {
      materialisedThrough: state!.materialisedThrough,
      firstFailedDate: failed,
    };
  });
}

/**
 * Whole-run per-organization mutual exclusion via the lease columns on
 * `attendance_day_open_state`. Row-based rather than `pg_advisory_lock`
 * because the DAL runs each transaction on its own pooled connection — a
 * session advisory lock taken in one transaction cannot be released from
 * another. A lease not renewed for 15 minutes is treated as abandoned and
 * taken over (see migration 0053). Only the holder can release its lease.
 */
export async function withOrganizationDayOpenLease<T>(
  ctx: RequestContext,
  body: (holder: string) => Promise<T>,
): Promise<T | { skipped: 'lease-held' }> {
  const holder = `day-open:${randomUUID()}`;
  const acquired = await db.transaction(ctx, async (tx) => {
    await repo.ensureDayOpenStateRow(tx, ctx.organizationId);
    return repo.tryAcquireDayOpenLease(tx, ctx.organizationId, holder);
  });
  if (!acquired) return { skipped: 'lease-held' };
  try {
    return await body(holder);
  } finally {
    await db.transaction(ctx, (tx) =>
      repo.releaseDayOpenLease(tx, ctx.organizationId, holder),
    );
  }
}

/**
 * Opens `date` for every employed person in the organization, one
 * transaction each. Returns true iff every person succeeded. A failure rolls
 * back only that person's row for that date and is logged; earlier commits
 * persist and `openDay`'s idempotency covers the retry.
 */
async function tryOpenDate(
  ctx: RequestContext,
  date: DateOnly,
  openOne: NonNullable<DayOpenOptions['openOne']>,
): Promise<boolean> {
  const userIds = await db.transaction(ctx, (tx) => repo.listEmployedUserIds(tx, date));
  let allOk = true;
  for (const userId of userIds) {
    try {
      await db.transaction(ctx, (tx) => openOne(tx, userId, date));
    } catch (error) {
      allOk = false;
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'day-open failed for a person',
          organizationId: ctx.organizationId,
          userId,
          date,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return allOk;
}

/**
 * Opens `date` for everyone employed on it who has no day yet: someone added
 * after the day was opened, or whose joining date moved onto it. The hourly
 * day-open job calls it once the watermark has reached today. A failure is
 * logged and left for the next hour. Returns how many days it opened.
 */
export async function openMissingDays(
  ctx: RequestContext,
  date: DateOnly,
): Promise<number> {
  const userIds = await db.transaction(ctx, (tx) => repo.employedWithoutDay(tx, date));
  let opened = 0;
  for (const userId of userIds) {
    try {
      await db.transaction(ctx, (tx) => openDay(tx, userId, date));
      opened += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'day-open failed for a person',
          organizationId: ctx.organizationId,
          userId,
          date,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return opened;
}
